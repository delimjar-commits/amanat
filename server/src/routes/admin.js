import express from 'express';
import { config } from '../config.js';
import { q, one, many, tx } from '../db.js';
import { allSettings, setSettings, encrypt } from '../settings.js';
import { llmConfig, lastCall, chat, normalizeBaseUrl } from '../llm.js';
import {
  HttpError, bad, verifyPassword, signToken, verifyToken, requireAdmin, requireRole, newTotpSecret, verifyTotp, signFile, sha256,
} from '../auth.js';
import { adminCopilot, fraudReport, riskForUser } from '../agents.js';
import { audit, notify, createAction, queuePayout, analyzeDispute, requeueDispute, computeTrust, publicUser, tk, alert } from '../services.js';
import { makePdf } from '../pdf.js';
import { runJob, jobStatus } from '../jobs.js';

export const router = express.Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const str = (v, max = 2000) => (v === undefined || v === null ? '' : String(v).trim().slice(0, max));
const ipOf = (req) => (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim() || null;

// ---------------- admin sign-in: password, then TOTP ----------------
router.post('/auth/login', wrap(async (req, res) => {
  const email = str(req.body.email, 200).toLowerCase();
  const u = await one('select * from profiles where email = $1 and deleted_at is null', [email]);
  if (!u || !verifyPassword(String(req.body.password || ''), u.password_hash)) throw new HttpError(401, 'Wrong email or password.');
  if (config.adminEmails.includes(email)) {
    await q(`insert into admin_users(user_id, role) values ($1, 'super_admin') on conflict (user_id) do update set active = true`, [u.id]);
  }
  const a = await one('select * from admin_users where user_id = $1 and active', [u.id]);
  if (!a || u.is_banned) throw new HttpError(403, 'This account is not an admin. Use the user app instead.', 'not_admin');
  const pre = signToken({ sub: u.id, aud: 'admin-pre' }, 600);
  if (!a.totp_enabled) {
    const secret = a.totp_secret || newTotpSecret();
    if (!a.totp_secret) await q('update admin_users set totp_secret = $2 where user_id = $1', [u.id, secret]);
    const label = encodeURIComponent(`${config.appName} Admin:${u.email}`);
    return res.json({ step: 'setup_2fa', pre_token: pre, secret, otpauth: `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(config.appName)}` });
  }
  res.json({ step: 'verify_2fa', pre_token: pre });
}));

router.post('/auth/2fa', wrap(async (req, res) => {
  const p = verifyToken(req.body.pre_token);
  if (!p || p.aud !== 'admin-pre') throw new HttpError(401, 'Sign in again.');
  const a = await one(`select a.*, p.email, p.display_name from admin_users a join profiles p on p.id = a.user_id where a.user_id = $1 and a.active`, [p.sub]);
  if (!a || !a.totp_secret) throw new HttpError(403, 'Not an admin.');
  if (!verifyTotp(a.totp_secret, req.body.code)) throw new HttpError(401, 'That code is not right. Use the 6-digit code from your authenticator app.');
  if (!a.totp_enabled) await q('update admin_users set totp_enabled = true where user_id = $1', [a.user_id]);
  await tx((c) => audit(c, a.user_id, 'admin', 'admin_login', 'profile', a.user_id, null, ipOf(req)));
  res.json({ token: signToken({ sub: a.user_id, aud: 'admin', mfa: true }, 60 * 60 * 12), admin: { id: a.user_id, email: a.email, name: a.display_name, role: a.role } });
}));

router.use(requireAdmin);

router.get('/me', wrap(async (req, res) => {
  res.json({ admin: { id: req.admin.user_id, email: req.admin.email, name: req.admin.display_name, role: req.admin.role } });
}));

// ---------------- dashboard ----------------
async function stats() {
  const r = await one(`select
    (select count(*)::int from profiles where deleted_at is null) users,
    (select count(*)::int from profiles where created_at > now() - interval '1 day') new_users_24h,
    (select count(*)::int from profiles where kyc_level in ('verified','business')) verified_users,
    (select count(*)::int from listings where status = 'active') active_listings,
    (select count(*)::int from deals where status in ('funded','handover_pending','shipped','buyer_confirmed','release_queued','disputed','refund_queued','split_queued')) open_deals,
    (select count(*)::int from deals where status = 'completed') completed_deals,
    (select coalesce(sum(debit_paisa - credit_paisa),0)::bigint from ledger_entries where account = 'escrow_hold') escrow_held_paisa,
    (select coalesce(sum(debit_paisa - credit_paisa),0)::bigint from ledger_entries where account = 'platform_fees') fees_earned_paisa,
    (select coalesce(sum(debit_paisa - credit_paisa),0)::bigint from ledger_entries where account = 'guarantee_fund') guarantee_fund_paisa,
    (select coalesce(sum(debit_paisa - credit_paisa),0)::bigint from ledger_entries where account = 'seller_payable') payouts_owed_paisa,
    (select count(*)::int from admin_actions where status = 'pending') pending_actions,
    (select count(*)::int from disputes where status <> 'resolved') open_disputes,
    (select count(*)::int from alerts where resolved_at is null) open_alerts,
    (select count(*)::int from support_tickets where status = 'open') open_tickets`);
  return r;
}

router.get('/dashboard', wrap(async (_req, res) => {
  const [s, volume, byType, alerts, ai] = await Promise.all([
    stats(),
    many(`select to_char(d::date, 'YYYY-MM-DD') as day, coalesce(sum(x.amount_paisa),0)::bigint paisa, count(x.id)::int deals
          from generate_series(current_date - 13, current_date, interval '1 day') d
          left join deals x on x.funded_at::date = d::date group by d order by d`),
    many(`select type, count(*)::int n from admin_actions where status = 'pending' group by type`),
    many(`select * from alerts where resolved_at is null order by priority, created_at desc limit 8`),
    llmConfig(),
  ]);
  res.json({ stats: s, volume, pending_by_type: byType, alerts, ai: { enabled: ai.enabled, last: lastCall } });
}));

// ---------------- approval queue ----------------
async function subjectFor(a) {
  if (a.subject_type === 'kyc') {
    const k = await one(`select k.*, row_to_json(p.*) u from kyc_submissions k join profiles p on p.id = k.user_id where k.id = $1`, [a.subject_id]);
    if (!k) return null;
    return {
      kind: 'kyc', title: `${k.u.display_name} · ${k.level === 'business' ? 'Business badge' : 'NID verification'}`,
      user: { ...publicUser(k.u), email: k.u.email, phone: k.u.phone },
      kyc: { id: k.id, level: k.level, status: k.status, name_en: k.full_name_en, name_bn: k.full_name_bn, dob: k.date_of_birth, nid_last4: k.nid_number_last4, liveness: k.liveness_passed, face_match: k.face_match_score, trade_licence_no: k.trade_licence_no, created_at: k.created_at },
      images: [
        { label: k.level === 'business' ? 'Trade licence' : 'NID front', url: signFile(k.nid_front_path, 900) },
        ...(k.level === 'business' ? [] : [{ label: 'NID back', url: signFile(k.nid_back_path, 900) }]),
        { label: 'Live selfie', url: signFile(k.selfie_path, 900) },
        ...(k.selfie_turn_path ? [{ label: 'Head turned', url: signFile(k.selfie_turn_path, 900) }] : []),
      ],
    };
  }
  if (a.subject_type === 'deal') {
    const d = await one('select * from deals where id = $1', [a.subject_id]);
    if (!d) return null;
    const [b, s, proofs, dispute, events] = await Promise.all([
      one('select * from profiles where id = $1', [d.buyer_id]),
      one('select * from profiles where id = $1', [d.seller_id]),
      many('select id, user_id, stage, lat, lng, accuracy_m, is_mock_location, source, captured_at, selfie_path, item_photo_paths from deal_proofs where deal_id = $1 order by captured_at', [d.id]),
      one('select * from disputes where deal_id = $1', [d.id]),
      many('select from_status, to_status, actor_kind, note, created_at from deal_events where deal_id = $1 order by id', [d.id]),
    ]);
    const evidence = dispute ? await many('select user_id, note, media_paths, created_at from dispute_evidence where dispute_id = $1 order by created_at', [dispute.id]) : [];
    const who = (id) => (id === d.buyer_id ? 'Buyer' : 'Seller');
    return {
      kind: 'deal', title: `${d.title} · ${tk(d.amount_paisa)}`,
      deal: { ...d, release_code_hash: undefined, release_code_salt: undefined, seller_net_paisa: d.amount_paisa - d.fee_paisa - d.guarantee_paisa },
      buyer: publicUser(b), seller: publicUser(s), events,
      proofs: proofs.map((p) => ({ ...p, who: who(p.user_id), selfie_url: signFile(p.selfie_path, 900), items: (p.item_photo_paths || []).map((x) => signFile(x, 900)), selfie_path: undefined, item_photo_paths: undefined })),
      dispute: dispute ? { ...dispute, opened_by_role: who(dispute.opened_by), evidence: evidence.map((e) => ({ ...e, who: who(e.user_id), media: (e.media_paths || []).map((m) => signFile(m, 900)) })) } : null,
    };
  }
  if (a.subject_type === 'payout') {
    const p = await one(`select po.*, pa.method, pa.account_number, pa.account_name, pa.name_matches_kyc, row_to_json(pr.*) u, d.title deal_title, d.status deal_status
      from payouts po join payout_accounts pa on pa.id = po.payout_account_id join profiles pr on pr.id = po.user_id left join deals d on d.id = po.deal_id where po.id = $1`, [a.subject_id]);
    if (!p) return null;
    const kyc = await one(`select full_name_en from kyc_submissions where user_id = $1 and status = 'approved' order by created_at desc limit 1`, [p.user_id]);
    return { kind: 'payout', title: `Payout ${tk(p.amount_paisa)} to ${p.u.display_name}`, payout: { ...p, u: undefined, account_number: `****${p.account_number.slice(-4)}`, kyc_name: kyc?.full_name_en }, user: publicUser(p.u) };
  }
  if (a.subject_type === 'listing') {
    const l = await one(`select l.*, row_to_json(p.*) u from listings l join profiles p on p.id = l.seller_id where l.id = $1`, [a.subject_id]);
    if (!l) return null;
    const photos = await many('select path from listing_photos where listing_id = $1 order by position', [l.id]);
    return { kind: 'listing', title: l.title, listing: { ...l, u: undefined }, user: publicUser(l.u), images: photos.map((p, i) => ({ label: `Photo ${i + 1}`, url: signFile(p.path, 900) })) };
  }
  if (a.subject_type === 'profile') {
    const p = await one('select * from profiles where id = $1', [a.subject_id]);
    return p ? { kind: 'profile', title: p.display_name, user: { ...publicUser(p), email: p.email, phone: p.phone, is_banned: p.is_banned } } : null;
  }
  return null;
}

router.get('/actions', wrap(async (req, res) => {
  const status = ['pending', 'approved', 'rejected', 'executed', 'failed'].includes(req.query.status) ? req.query.status : 'pending';
  const params = [status];
  let where = 'a.status = $1';
  if (req.query.type) { params.push(req.query.type); where += ` and a.type = $${params.length}`; }
  const rows = await many(
    `select a.*, r.agent, r.recommendation, r.confidence, r.risk_score, r.summary ai_summary, p.display_name decided_by_name
     from admin_actions a left join ai_reviews r on r.id = a.ai_review_id left join profiles p on p.id = a.decided_by
     where ${where} order by ${status === 'pending' ? 'a.priority, a.created_at' : 'coalesce(a.decided_at, a.created_at) desc'} limit 200`,
    params,
  );
  const titles = await Promise.all(rows.map(async (a) => {
    if (a.subject_type === 'kyc') return (await one('select p.display_name t from kyc_submissions k join profiles p on p.id = k.user_id where k.id = $1', [a.subject_id]))?.t;
    if (a.subject_type === 'deal') return (await one('select title t from deals where id = $1', [a.subject_id]))?.t;
    if (a.subject_type === 'payout') return (await one('select p.display_name t from payouts po join profiles p on p.id = po.user_id where po.id = $1', [a.subject_id]))?.t;
    if (a.subject_type === 'listing') return (await one('select title t from listings where id = $1', [a.subject_id]))?.t;
    if (a.subject_type === 'profile') return (await one('select display_name t from profiles where id = $1', [a.subject_id]))?.t;
    return null;
  }));
  const s = await allSettings();
  res.json({
    actions: rows.map((a, i) => ({ ...a, subject_title: titles[i], can_decide: roleCan(req.admin.role, a.type), bulk_ok: bulkOk(a, s) })),
  });
}));

function roleCan(role, type) {
  if (role === 'super_admin') return true;
  const m = { approve_kyc: ['kyc_reviewer'], reject_kyc: ['kyc_reviewer'], release_escrow: ['dispute_agent', 'finance'], refund_escrow: ['dispute_agent'], split_escrow: ['dispute_agent'], approve_payout: ['finance'], remove_listing: ['support', 'dispute_agent'], blacklist_add: ['dispute_agent'] };
  return (m[type] || []).includes(role);
}
const bulkOk = (a, s) => a.status === 'pending' && ['approve_kyc', 'release_escrow'].includes(a.type) && ['approve', 'release'].includes(a.recommendation) && Number(a.confidence) >= Number(s.bulk_approve_min_confidence) && (a.risk_score ?? (a.payload?.risk_score ?? 0)) <= Number(s.bulk_approve_max_risk) && !a.payload?.resolves_dispute;

router.get('/actions/:id', wrap(async (req, res) => {
  const a = await one(`select a.*, p.display_name decided_by_name from admin_actions a left join profiles p on p.id = a.decided_by where a.id = $1`, [req.params.id]);
  if (!a) throw new HttpError(404, 'Not found');
  const [review, subject, history] = await Promise.all([
    a.ai_review_id ? one('select * from ai_reviews where id = $1', [a.ai_review_id]) : null,
    subjectFor(a),
    many(`select a2.id, a2.type, a2.status, a2.decision_note, a2.decided_at, p.display_name by from admin_actions a2 left join profiles p on p.id = a2.decided_by where a2.subject_id = $1 and a2.id <> $2 order by a2.created_at desc limit 10`, [a.subject_id, a.id]),
  ]);
  let risk = null;
  const uid = subject?.user?.id;
  if (uid) risk = await tx((c) => riskForUser(c, uid));
  res.json({ action: { ...a, can_decide: roleCan(req.admin.role, a.type) }, review, subject, history, risk });
}));

// approve / reject / edit-then-approve. Only route that ends in execute_admin_action.
async function decide(adminRowObj, actionId, { decision, note, payload_edit }, ip) {
  const out = await tx(async (c) => {
    const a = await c.one('select * from admin_actions where id = $1 for update', [actionId]);
    if (!a) throw new HttpError(404, 'Not found');
    if (a.status !== 'pending') throw new HttpError(409, `Already ${a.status}.`);
    if (!roleCan(adminRowObj.role, a.type)) throw new HttpError(403, `Your role (${adminRowObj.role}) can't decide ${a.type.replace(/_/g, ' ')}.`);
    if (decision === 'reject') {
      if (!note) throw bad('Add a short reason so the history is clear.');
      await c.query(`update admin_actions set status = 'rejected', decided_by = $2, decided_at = now(), decision_note = $3 where id = $1`, [a.id, adminRowObj.user_id, note]);
      await afterReject(c, a, adminRowObj, note);
      await audit(c, adminRowObj.user_id, 'admin', `reject:${a.type}`, a.subject_type, a.subject_id, { action_id: a.id, note }, ip);
      return { status: 'rejected' };
    }
    // "edit then approve" for split amounts: the original stays rejected, a new action carries the edit
    let target = a;
    if (payload_edit && a.type === 'split_escrow') {
      const d = await c.one('select amount_paisa from deals where id = $1', [a.subject_id]);
      const bp = Math.round(Number(payload_edit.buyer_paisa));
      if (!(bp >= 0 && bp <= d.amount_paisa)) throw bad('The buyer share must be between 0 and the deal amount.');
      await c.query(`update admin_actions set status = 'rejected', decided_by = $2, decided_at = now(), decision_note = $3 where id = $1`, [a.id, adminRowObj.user_id, `Edited: buyer ${tk(bp)}`]);
      target = await c.one(
        `insert into admin_actions(type, subject_type, subject_id, payload, ai_review_id, priority, requested_by) values ('split_escrow','deal',$1,$2,$3,$4,$5) returning *`,
        [a.subject_id, JSON.stringify({ ...a.payload, buyer_paisa: bp, seller_paisa: d.amount_paisa - bp }), a.ai_review_id, a.priority, `admin:${adminRowObj.user_id}`],
      );
    }
    await c.query(`update admin_actions set status = 'approved', decided_by = $2, decided_at = now(), decision_note = $3 where id = $1`, [target.id, adminRowObj.user_id, note || null]);
    return { status: 'approved', id: target.id, a: target };
  });
  if (out.status !== 'approved') return out;
  // execute in its own transaction; a failure is recorded as failed, never left half-done
  try {
    await tx(async (c) => {
      await c.query('select execute_admin_action($1)', [out.id]);
      await afterExecute(c, out.a, adminRowObj);
    });
    return { status: 'executed', id: out.id };
  } catch (e) {
    await q(`update admin_actions set status = 'failed', error = $2 where id = $1 and status = 'approved'`, [out.id, String(e.message).slice(0, 500)]);
    throw new HttpError(409, `Approved, but it could not run: ${e.message}`, 'exec_failed');
  }
}

async function afterExecute(c, a, adm) {
  if (['release_escrow', 'refund_escrow', 'split_escrow'].includes(a.type)) {
    const d = await c.one('select * from deals where id = $1', [a.subject_id]);
    const disp = await c.one('select * from disputes where deal_id = $1', [d.id]);
    if (disp) {
      const loser = a.type === 'refund_escrow' ? d.seller_id : a.type === 'release_escrow' ? d.buyer_id : null;
      await c.query('update disputes set loser_id = $2 where id = $1', [disp.id, loser]);
      if (loser) await computeTrust(c, loser);
    }
    if (a.type === 'refund_escrow') {
      await notify(c, d.buyer_id, 'Refund approved', `${tk(d.amount_paisa)} for "${d.title}" is being refunded to you.`, { kind: 'deal', deal_id: d.id });
      await notify(c, d.seller_id, 'Deal refunded', `"${d.title}" was refunded to the buyer.`, { kind: 'deal', deal_id: d.id });
      await c.query(`insert into messages(chat_id, kind, body, deal_id) values ($1,'system',$2,$3)`, [d.chat_id, `An admin approved a refund of ${tk(d.amount_paisa)} to the buyer.`, d.id]);
    } else {
      const bp = a.type === 'split_escrow' ? Number(a.payload.buyer_paisa) : 0;
      await notify(c, d.seller_id, 'Payment released', `"${d.title}" was released. Your payout is on its way to approval.`, { kind: 'deal', deal_id: d.id });
      if (bp) await notify(c, d.buyer_id, 'Split decided', `${tk(bp)} is refunded to you for "${d.title}".`, { kind: 'deal', deal_id: d.id });
      else await notify(c, d.buyer_id, 'Deal released', `"${d.title}" was released to the seller.`, { kind: 'deal', deal_id: d.id });
      await c.query(`insert into messages(chat_id, kind, body, deal_id) values ($1,'system',$2,$3)`, [d.chat_id, a.type === 'split_escrow' ? `An admin split the payment: ${tk(bp)} back to the buyer, the rest to the seller.` : 'An admin approved the release. The seller will be paid.', d.id]);
      await queuePayout(c, d.id);
    }
  }
  if (a.type === 'approve_payout') {
    const p = await c.one('select * from payouts where id = $1', [a.subject_id]);
    const d = await c.one('select * from deals where id = $1', [p.deal_id]);
    await notify(c, p.user_id, 'Payout sent', `${tk(p.amount_paisa)} was sent to your account.`, { kind: 'payout', deal_id: d.id });
    await notify(c, d.buyer_id, 'Deal complete', `How was "${d.title}"? Leave a quick review.`, { kind: 'deal', deal_id: d.id });
    await notify(c, d.seller_id, 'Deal complete', `Leave a review for the buyer of "${d.title}".`, { kind: 'deal', deal_id: d.id });
    await computeTrust(c, d.buyer_id); await computeTrust(c, d.seller_id);
  }
  if (a.type === 'remove_listing') {
    const l = await c.one('select seller_id, title from listings where id = $1', [a.subject_id]);
    await notify(c, l.seller_id, 'Listing removed', `"${l.title}" broke our rules and was removed.`, { kind: 'listing' });
  }
  if (a.type === 'ban_user') await c.query(`update listings set status = 'removed' where seller_id = $1 and status in ('active','paused','pending_review')`, [a.subject_id]);
}

async function afterReject(c, a, adm, note) {
  if (a.type === 'remove_listing') {
    // admin says the listing is fine: publish it
    const l = await c.one(`update listings set status = 'active' where id = $1 and status = 'pending_review' returning seller_id, title`, [a.subject_id]);
    if (l) await notify(c, l.seller_id, 'Listing approved', `"${l.title}" is live now.`, { kind: 'listing' });
  }
  if (a.type === 'approve_kyc') {
    await c.query(`update kyc_submissions set status = 'resubmit' where id = $1 and status in ('pending','ai_checked')`, [a.subject_id]);
    const k = await c.one('select user_id from kyc_submissions where id = $1', [a.subject_id]);
    await notify(c, k.user_id, 'Please try verification again', note, { kind: 'kyc' });
  }
  if (a.type === 'reject_kyc') {
    // admin disagrees with the AI's rejection: queue an approval instead
    await createAction(c, { type: 'approve_kyc', subject_type: 'kyc', subject_id: a.subject_id, payload: a.payload, ai_review_id: a.ai_review_id, priority: 2, requested_by: `admin:${adm.user_id}` });
  }
  if (a.type === 'release_escrow' && !a.payload?.resolves_dispute) {
    await alert(c, { kind: 'release_rejected', priority: 1, subject_type: 'deal', subject_id: a.subject_id, title: 'Release rejected: deal is on hold', body: note });
  }
}

router.post('/actions/:id/decide', wrap(async (req, res) => {
  const decision = req.body.decision === 'reject' ? 'reject' : 'approve';
  res.json(await decide(req.admin, req.params.id, { decision, note: str(req.body.note, 500), payload_edit: req.body.payload_edit }, ipOf(req)));
}));

// bulk approve only for high-confidence, low-risk items
router.post('/actions/bulk-approve', wrap(async (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids.slice(0, 50) : [];
  const s = await allSettings();
  const results = [];
  for (const id of ids) {
    const a = await one('select a.*, r.recommendation, r.confidence, r.risk_score from admin_actions a left join ai_reviews r on r.id = a.ai_review_id where a.id = $1', [id]);
    if (!a || !bulkOk(a, s)) { results.push({ id, status: 'skipped', reason: 'not eligible for bulk approve' }); continue; }
    try { results.push({ id, ...(await decide(req.admin, id, { decision: 'approve', note: 'Bulk approved' }, ipOf(req))) }); }
    catch (e) { results.push({ id, status: 'error', reason: e.message }); }
  }
  res.json({ results });
}));

// admin requests an action (ban, blacklist, police export...) into the queue; another click approves it
router.post('/actions', wrap(async (req, res) => {
  const type = str(req.body.type, 40);
  if (!['ban_user', 'unban_user', 'remove_listing', 'police_handover', 'blacklist_add'].includes(type)) throw bad('This action is created by the system, not by hand.');
  const subject_type = type === 'remove_listing' ? 'listing' : 'profile';
  const a = await tx((c) => createAction(c, { type, subject_type, subject_id: req.body.subject_id, payload: { reason: str(req.body.reason, 500) }, priority: type === 'police_handover' ? 1 : 2, requested_by: `admin:${req.admin.user_id}` }));
  res.json({ action: a });
}));

// ---------------- disputes ----------------
router.get('/disputes', wrap(async (_req, res) => {
  const rows = await many(`select ds.*, d.title, d.amount_paisa, d.status deal_status, b.display_name buyer, s.display_name seller,
    (select count(*)::int from dispute_evidence e where e.dispute_id = ds.id) evidence_count
    from disputes ds join deals d on d.id = ds.deal_id join profiles b on b.id = d.buyer_id join profiles s on s.id = d.seller_id
    order by (ds.status = 'resolved'), ds.created_at desc limit 100`);
  res.json({ disputes: rows });
}));
router.post('/disputes/:id/analyze', requireRole('dispute_agent'), wrap(async (req, res) => {
  const r = await tx((c) => analyzeDispute(c, req.params.id));
  res.json({ review: r });
}));
router.post('/deals/:id/resolve', requireRole('dispute_agent'), wrap(async (req, res) => {
  const to = ['refund', 'release', 'split'].includes(req.body.to) ? req.body.to : null;
  if (!to) throw bad('Choose refund, release or split.');
  const a = await tx((c) => requeueDispute(c, req.params.id, to, req.body.buyer_paisa, req.admin.user_id));
  res.json({ action: a });
}));

// ---------------- users ----------------
router.get('/users', wrap(async (req, res) => {
  const params = [];
  let where = 'deleted_at is null';
  if (req.query.q) { params.push(`%${str(req.query.q, 80)}%`); where += ` and (display_name ilike $1 or email ilike $1 or phone ilike $1)`; }
  if (req.query.filter === 'banned') where += ' and is_banned';
  if (req.query.filter === 'verified') where += ` and kyc_level in ('verified','business')`;
  const rows = await many(`select p.*, a.role admin_role from profiles p left join admin_users a on a.user_id = p.id and a.active where ${where} order by created_at desc limit 100`, params);
  res.json({ users: rows.map((p) => ({ ...publicUser(p), email: p.email, phone: p.phone, is_banned: p.is_banned, admin_role: p.admin_role })) });
}));
router.get('/users/:id', wrap(async (req, res) => {
  const p = await one('select * from profiles where id = $1', [req.params.id]);
  if (!p) throw new HttpError(404, 'Not found');
  const [kyc, deals, reports, devices, risk, payoutAccts, admin] = await Promise.all([
    many('select id, level, status, nid_number_last4, full_name_en, face_match_score, liveness_passed, created_at from kyc_submissions where user_id = $1 order by created_at desc', [p.id]),
    many('select id, title, status, amount_paisa, created_at, case when buyer_id = $1 then \'buyer\' else \'seller\' end role from deals where buyer_id = $1 or seller_id = $1 order by created_at desc limit 30', [p.id]),
    many('select r.reason, r.status, r.created_at, pr.display_name reporter from reports r left join profiles pr on pr.id = r.reporter_id where target_user_id = $1 order by created_at desc limit 20', [p.id]),
    many(`select d.device_fingerprint, d.first_seen, (select array_agg(p2.email) from devices d2 join profiles p2 on p2.id = d2.user_id where d2.device_fingerprint = d.device_fingerprint and d2.user_id <> d.user_id) shared_with from devices d where d.user_id = $1`, [p.id]),
    tx((c) => riskForUser(c, p.id)),
    many('select method, account_name, name_matches_kyc, right(account_number,4) last4 from payout_accounts where user_id = $1', [p.id]),
    one('select role, active from admin_users where user_id = $1', [p.id]),
  ]);
  res.json({ user: { ...publicUser(p), email: p.email, phone: p.phone, is_banned: p.is_banned, admin }, kyc, deals, reports, devices, risk, payout_accounts: payoutAccts });
}));

router.post('/users/:id/role', requireRole(), wrap(async (req, res) => {
  const role = req.body.role;
  if (role === null || role === 'none') {
    const target = await one('select email from profiles where id = $1', [req.params.id]);
    if (config.adminEmails.includes(target?.email)) throw bad('This admin is set in ADMIN_EMAILS and can\'t be removed here.');
    await q('update admin_users set active = false where user_id = $1', [req.params.id]);
  } else {
    if (!['super_admin', 'kyc_reviewer', 'dispute_agent', 'support', 'finance'].includes(role)) throw bad('Unknown role');
    await q(`insert into admin_users(user_id, role) values ($1,$2) on conflict (user_id) do update set role = excluded.role, active = true`, [req.params.id, role]);
  }
  await tx((c) => audit(c, req.admin.user_id, 'admin', 'set_role', 'profile', req.params.id, { role }, ipOf(req)));
  res.json({ ok: true });
}));

// ---------------- listings, reports ----------------
router.get('/listings', wrap(async (req, res) => {
  const st = str(req.query.status, 20);
  const rows = await many(`select l.*, p.display_name seller, (select path from listing_photos where listing_id = l.id order by position limit 1) photo from listings l join profiles p on p.id = l.seller_id ${st ? 'where l.status = $1' : ''} order by l.created_at desc limit 100`, st ? [st] : []);
  res.json({ listings: rows.map((l) => ({ ...l, photo: signFile(l.photo, 900) })) });
}));
router.get('/reports', wrap(async (_req, res) => {
  res.json({ reports: await many(`select r.*, pr.display_name reporter, tu.display_name target_user, l.title target_listing, m.body target_message from reports r left join profiles pr on pr.id = r.reporter_id left join profiles tu on tu.id = r.target_user_id left join listings l on l.id = r.target_listing_id left join messages m on m.id = r.target_message_id order by (r.status <> 'open'), r.created_at desc limit 100`) });
}));
router.post('/reports/:id', wrap(async (req, res) => {
  const st = ['upheld', 'dismissed'].includes(req.body.status) ? req.body.status : null;
  if (!st) throw bad('Choose upheld or dismissed');
  const r = await one('update reports set status = $2 where id = $1 returning *', [req.params.id, st]);
  if (r?.target_user_id) await tx((c) => computeTrust(c, r.target_user_id));
  await tx((c) => audit(c, req.admin.user_id, 'admin', `report_${st}`, 'report', req.params.id, null, ipOf(req)));
  res.json({ ok: true });
}));

// ---------------- alerts (SOS, lockouts, ledger, fraud) ----------------
router.get('/alerts', wrap(async (req, res) => {
  res.json({ alerts: await many(`select * from alerts ${req.query.all ? '' : 'where resolved_at is null'} order by (resolved_at is not null), priority, created_at desc limit 100`) });
}));
router.post('/alerts/:id/resolve', wrap(async (req, res) => {
  const a = await one('update alerts set resolved_at = now(), resolved_by = $2 where id = $1 returning *', [req.params.id, req.admin.user_id]);
  if (a?.kind === 'sos' && a.data?.sos_id) await q(`update sos_alerts set status = 'resolved', updated_at = now() where id = $1`, [a.data.sos_id]);
  if (a?.kind === 'release_code_lockout' && req.body.unlock) await q('update deals set release_code_locked = false, release_code_attempts = 0 where id = $1', [a.subject_id]);
  await tx((c) => audit(c, req.admin.user_id, 'admin', 'resolve_alert', 'alert', req.params.id, { kind: a?.kind, unlock: !!req.body.unlock }, ipOf(req)));
  res.json({ ok: true });
}));

// ---------------- deals & ledger ----------------
router.get('/deals', wrap(async (req, res) => {
  const st = str(req.query.status, 30);
  const rows = await many(`select d.id, d.title, d.status, d.amount_paisa, d.handover, d.risk_score, d.created_at, b.display_name buyer, s.display_name seller from deals d join profiles b on b.id = d.buyer_id join profiles s on s.id = d.seller_id ${st ? 'where d.status = $1' : ''} order by d.created_at desc limit 150`, st ? [st] : []);
  res.json({ deals: rows });
}));
router.get('/deals/:id', wrap(async (req, res) => {
  const s = await subjectFor({ subject_type: 'deal', subject_id: req.params.id });
  if (!s) throw new HttpError(404, 'Not found');
  const [ledger, actions, msgs] = await Promise.all([
    many('select id, txn_id, account, debit_paisa, credit_paisa, memo, created_at from ledger_entries where deal_id = $1 order by id', [req.params.id]),
    many('select a.id, a.type, a.status, a.created_at, a.decided_at, p.display_name by from admin_actions a left join profiles p on p.id = a.decided_by where subject_id = $1 order by created_at', [req.params.id]),
    many(`select m.kind, m.body, m.ai_flag, m.created_at, p.display_name sender from messages m left join profiles p on p.id = m.sender_id where m.chat_id = (select chat_id from deals where id = $1) order by m.created_at desc limit 80`, [req.params.id]),
  ]);
  res.json({ ...s, ledger, actions, messages: msgs.reverse() });
}));

router.get('/ledger', requireRole('finance'), wrap(async (req, res) => {
  const [balances, entries, verify] = await Promise.all([
    many(`select account, coalesce(sum(debit_paisa),0)::bigint debit, coalesce(sum(credit_paisa),0)::bigint credit, coalesce(sum(debit_paisa - credit_paisa),0)::bigint balance from ledger_entries group by account order by account`),
    many('select e.id, e.txn_id, e.deal_id, e.account, e.debit_paisa, e.credit_paisa, e.memo, e.created_at, left(e.entry_hash, 12) hash from ledger_entries e order by id desc limit 200'),
    one('select * from ledger_verify()'),
  ]);
  res.json({ balances, entries, verify });
}));

// ---------------- AI ----------------
router.get('/ai/reviews', wrap(async (req, res) => {
  const agent = str(req.query.agent, 40);
  res.json({ reviews: await many(`select * from ai_reviews ${agent ? 'where agent = $1' : ''} order by created_at desc limit 100`, agent ? [agent] : []) });
}));
router.post('/ai/copilot', wrap(async (req, res) => {
  const question = str(req.body.question, 800);
  if (!question) throw bad('Ask a question.');
  const [s, pending, disputes, alerts, recent] = await Promise.all([
    stats(),
    many(`select a.type, a.priority, a.created_at, r.recommendation, r.confidence, r.summary from admin_actions a left join ai_reviews r on r.id = a.ai_review_id where a.status = 'pending' order by a.priority, a.created_at limit 40`),
    many(`select ds.reason, ds.status, d.title, d.amount_paisa, ds.created_at from disputes ds join deals d on d.id = ds.deal_id where ds.status <> 'resolved' limit 20`),
    many(`select kind, title, body, created_at from alerts where resolved_at is null order by priority limit 20`),
    many(`select title, status, amount_paisa, created_at from deals order by created_at desc limit 30`),
  ]);
  try {
    res.json({ answer: await adminCopilot(question, { stats: s, pending_actions: pending, open_disputes: disputes, alerts, recent_deals: recent, now: new Date().toISOString() }) });
  } catch (e) {
    res.json({ answer: `The AI did not answer (${e.message.slice(0, 120)}). Check the AI settings.`, error: true });
  }
}));
router.post('/ai/fraud-report', wrap(async (_req, res) => {
  res.json({ review: await tx((c) => fraudReport(c)) });
}));

// ---------------- settings ----------------
const EDITABLE = ['platform_fee_percent', 'guarantee_fund_percent', 'auto_release_hours', 'dispute_evidence_hours', 'release_code_max_attempts', 'trip_share_link_hours', 'limit_level1', 'limit_level2', 'limit_level3', 'new_user_deal_limit', 'dispute_agent_refund_limit', 'bulk_approve_min_confidence', 'bulk_approve_max_risk', 'face_match_threshold', 'categories', 'banned_words'];
router.get('/settings', wrap(async (_req, res) => {
  const s = await allSettings();
  const ai = s.ai || {};
  const cfg = await llmConfig();
  res.json({
    settings: Object.fromEntries(EDITABLE.map((k) => [k, s[k]])),
    ai: { enabled: cfg.enabled, base_url: ai.baseUrl || '', has_key: !!ai.apiKeyEnc, key_hint: ai.keyHint || '', model_fast: ai.modelFast || '', model_strong: ai.modelStrong || '', model_vision: ai.modelVision || '', last: lastCall },
    env: { payment_provider: config.paymentProvider, courier_provider: config.courierProvider, sandbox: config.sandbox, admin_emails: config.adminEmails.length },
  });
}));
router.put('/settings', requireRole(), wrap(async (req, res) => {
  const out = {};
  for (const k of EDITABLE) {
    if (req.body[k] === undefined) continue;
    const v = req.body[k];
    if (k === 'categories' || k === 'banned_words') {
      if (!Array.isArray(v)) throw bad(`${k} must be a list`);
      out[k] = v.map((x) => str(x, 60)).filter(Boolean).slice(0, 60);
    } else {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0) throw bad(`${k.replace(/_/g, ' ')} must be a number of zero or more`);
      if (k.endsWith('_percent') && n > 20) throw bad('Percent fees above 20 are not allowed');
      out[k] = n;
    }
  }
  await setSettings(out);
  await tx((c) => audit(c, req.admin.user_id, 'admin', 'update_settings', 'settings', null, out, ipOf(req)));
  res.json({ ok: true });
}));
router.put('/settings/ai', requireRole(), wrap(async (req, res) => {
  const s = await allSettings();
  const ai = { ...(s.ai || {}) };
  if (req.body.base_url !== undefined) ai.baseUrl = normalizeBaseUrl(req.body.base_url);
  if (req.body.api_key) { ai.apiKeyEnc = encrypt(String(req.body.api_key).trim()); ai.keyHint = `…${String(req.body.api_key).trim().slice(-4)}`; }
  if (req.body.clear_key) { delete ai.apiKeyEnc; delete ai.keyHint; }
  for (const [k, f] of [['model_fast', 'modelFast'], ['model_strong', 'modelStrong'], ['model_vision', 'modelVision']]) if (req.body[k] !== undefined) ai[f] = str(req.body[k], 120);
  if (req.body.enabled !== undefined) ai.enabled = !!req.body.enabled;
  await setSettings({ ai });
  await tx((c) => audit(c, req.admin.user_id, 'admin', 'update_ai_settings', 'settings', null, { base_url: ai.baseUrl, models: [ai.modelFast, ai.modelStrong, ai.modelVision], key_changed: !!req.body.api_key }, ipOf(req)));
  res.json({ ok: true });
}));
router.post('/settings/ai/test', wrap(async (_req, res) => {
  try {
    const r = await chat([{ role: 'user', content: 'Reply with the single word: ready' }], { tier: 'fast', timeoutMs: 20000, maxTokens: 10 });
    res.json({ ok: true, model: r.model, reply: r.text.slice(0, 60) });
  } catch (e) {
    res.json({ ok: false, error: e.message.slice(0, 300) });
  }
}));

// ---------------- safe spots ----------------
router.get('/safe-spots', wrap(async (_req, res) => res.json({ spots: await many('select * from safe_spots order by area, name') })));
router.post('/safe-spots', wrap(async (req, res) => {
  const name = str(req.body.name, 100), area = str(req.body.area, 80);
  const lat = Number(req.body.lat), lng = Number(req.body.lng);
  if (!name || !area || !Number.isFinite(lat) || !Number.isFinite(lng)) throw bad('Name, area, latitude and longitude are needed.');
  res.json({ spot: await one('insert into safe_spots(name, area, note, lat, lng) values ($1,$2,$3,$4,$5) returning *', [name, area, str(req.body.note, 200) || null, lat, lng]) });
}));
router.delete('/safe-spots/:id', wrap(async (req, res) => {
  await q('update safe_spots set active = false where id = $1', [req.params.id]);
  res.json({ ok: true });
}));

// ---------------- support tickets ----------------
router.get('/support', wrap(async (_req, res) => {
  const rows = await many(`select t.*, p.display_name, p.email, (select body from support_messages m where m.user_id = t.user_id order by created_at desc limit 1) last from support_tickets t join profiles p on p.id = t.user_id order by (t.status <> 'open'), t.created_at desc limit 100`);
  res.json({ tickets: rows });
}));
router.get('/support/:id', wrap(async (req, res) => {
  const t = await one('select t.*, p.display_name from support_tickets t join profiles p on p.id = t.user_id where t.id = $1', [req.params.id]);
  if (!t) throw new HttpError(404, 'Not found');
  res.json({ ticket: t, messages: await many('select role, body, created_at from support_messages where user_id = $1 order by created_at desc limit 60', [t.user_id]).then((r) => r.reverse()) });
}));
router.post('/support/:id/reply', wrap(async (req, res) => {
  const t = await one('select * from support_tickets where id = $1', [req.params.id]);
  if (!t) throw new HttpError(404, 'Not found');
  const body = str(req.body.body, 2000);
  if (body) {
    await q(`insert into support_messages(user_id, ticket_id, role, body) values ($1,$2,'admin',$3)`, [t.user_id, t.id, body]);
    await q('insert into notifications(user_id, title, body, data) values ($1,$2,$3,$4)', [t.user_id, 'Support replied', body.slice(0, 140), JSON.stringify({ kind: 'support' })]);
  }
  if (req.body.close) await q(`update support_tickets set status = 'closed' where id = $1`, [t.id]);
  res.json({ ok: true });
}));

// ---------------- audit log, police export, jobs ----------------
router.get('/audit', requireRole(), wrap(async (_req, res) => {
  res.json({ entries: await many('select a.*, p.display_name actor from audit_log a left join profiles p on p.id = a.actor_id order by a.id desc limit 200') });
}));

router.get('/police-export/:actionId', requireRole(), wrap(async (req, res) => {
  const a = await one(`select * from admin_actions where id = $1 and type = 'police_handover' and status = 'executed'`, [req.params.actionId]);
  if (!a) throw new HttpError(403, 'The handover must be approved first.');
  const p = await one('select * from profiles where id = $1', [a.subject_id]);
  const [kyc, deals, proofs, devices, accts] = await Promise.all([
    many('select level, status, full_name_en, date_of_birth, nid_number_last4, created_at from kyc_submissions where user_id = $1 order by created_at', [p.id]),
    many('select id, title, status, amount_paisa, created_at from deals where buyer_id = $1 or seller_id = $1 order by created_at', [p.id]),
    many('select deal_id, stage, lat, lng, is_mock_location, captured_at from deal_proofs where user_id = $1 order by captured_at', [p.id]),
    many('select device_fingerprint, first_seen from devices where user_id = $1', [p.id]),
    many('select method, account_name, right(account_number,4) last4 from payout_accounts where user_id = $1', [p.id]),
  ]);
  const blocks = [
    { text: `${config.appName} - Law enforcement data handover`, size: 16, bold: true },
    { text: `Generated ${new Date().toISOString()} by ${req.admin.email}. Approval record: ${a.id}. Reason: ${a.payload?.reason || '-'}`, size: 9 },
    { text: 'Account', size: 12, bold: true, gap: 12 },
    { text: `Name: ${p.display_name}\nEmail: ${p.email}\nPhone: ${p.phone || '-'}\nCreated: ${p.created_at.toISOString()}\nKYC level: ${p.kyc_level}\nBanned: ${p.is_banned}` },
    { text: 'Identity checks', size: 12, bold: true, gap: 12 },
    ...kyc.map((k) => ({ text: `${k.level} ${k.status}: ${k.full_name_en || '-'}, born ${k.date_of_birth ? k.date_of_birth.toISOString().slice(0, 10) : '-'}, NID ending ${k.nid_number_last4}, ${k.created_at.toISOString()}` })),
    { text: 'Deals', size: 12, bold: true, gap: 12 },
    ...deals.map((d) => ({ text: `${d.created_at.toISOString().slice(0, 16)}  ${d.status}  BDT ${(d.amount_paisa / 100).toFixed(2)}  ${d.title}  (${d.id})` })),
    { text: 'Location proofs', size: 12, bold: true, gap: 12 },
    ...proofs.map((x) => ({ text: `${x.captured_at.toISOString().slice(0, 16)}  ${x.stage}  ${x.lat.toFixed(5)}, ${x.lng.toFixed(5)}${x.is_mock_location ? '  MOCK LOCATION' : ''}  deal ${x.deal_id}` })),
    { text: 'Devices and payout accounts', size: 12, bold: true, gap: 12 },
    ...devices.map((d) => ({ text: `Device ${d.device_fingerprint.slice(0, 16)}..., first seen ${d.first_seen.toISOString()}` })),
    ...accts.map((x) => ({ text: `${x.method} ****${x.last4} in the name of ${x.account_name}` })),
  ];
  const pdf = makePdf(blocks, { title: `Handover ${p.id.slice(0, 8)}` });
  await tx((c) => audit(c, req.admin.user_id, 'admin', 'police_export_download', 'profile', p.id, { action_id: a.id, sha256: sha256(pdf) }, ipOf(req)));
  res.set('content-type', 'application/pdf').set('content-disposition', `attachment; filename="handover-${p.id.slice(0, 8)}.pdf"`).send(pdf);
}));

router.get('/jobs', wrap(async (_req, res) => res.json({ jobs: jobStatus() })));
router.post('/jobs/:name/run', requireRole(), wrap(async (req, res) => res.json({ result: await runJob(req.params.name) })));
