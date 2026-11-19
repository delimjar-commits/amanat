import crypto from 'node:crypto';
import { config } from './config.js';
import { tx, one } from './db.js';
import { allSettings } from './settings.js';
import { releaseCodeFor, releaseCodeHash, signFile, HttpError } from './auth.js';
import { dealVerifier, disputeAnalyst, riskForDeal } from './agents.js';

export const ACTIVE_DEAL = ['funded', 'handover_pending', 'shipped', 'buyer_confirmed'];

export async function notify(c, userId, title, body, data = {}) {
  await c.query('insert into notifications(user_id, title, body, data) values ($1,$2,$3,$4)', [userId, title, body, JSON.stringify(data)]);
}
export async function audit(c, actorId, kind, action, subjectType, subjectId, data, ip) {
  await c.query(
    'insert into audit_log(actor_id, actor_kind, action, subject_type, subject_id, data, ip) values ($1,$2,$3,$4,$5,$6,$7)',
    [actorId || null, kind, action, subjectType || null, subjectId || null, data ? JSON.stringify(data) : null, ip || null],
  );
}
export async function alert(c, { kind, priority = 2, subject_type, subject_id, title, body, data }) {
  return c.one(
    'insert into alerts(kind, priority, subject_type, subject_id, title, body, data) values ($1,$2,$3,$4,$5,$6,$7) returning *',
    [kind, priority, subject_type || null, subject_id || null, title, body || null, data ? JSON.stringify(data) : null],
  );
}

// One pending action per subject+type: a repeat request returns the existing one.
export async function createAction(c, { type, subject_type, subject_id, payload = {}, ai_review_id = null, priority = 3, requested_by }) {
  const existing = await c.one(`select * from admin_actions where type = $1 and subject_id = $2 and status = 'pending'`, [type, subject_id]);
  if (existing) return existing;
  return c.one(
    `insert into admin_actions(type, subject_type, subject_id, payload, ai_review_id, priority, requested_by) values ($1,$2,$3,$4,$5,$6,$7) returning *`,
    [type, subject_type, subject_id, JSON.stringify(payload), ai_review_id, priority, requested_by],
  );
}

export async function sysMessage(c, chatId, body, dealId = null) {
  if (!chatId) return;
  await c.query(`insert into messages(chat_id, sender_id, kind, body, deal_id) values ($1, null, 'system', $2, $3)`, [chatId, body, dealId]);
}

export async function fees(amountPaisa) {
  const s = await allSettings();
  const fp = Number(s.platform_fee_percent), gp = Number(s.guarantee_fund_percent);
  return { fee_percent: fp, guarantee_percent: gp, fee_paisa: Math.round((amountPaisa * fp) / 100), guarantee_paisa: Math.round((amountPaisa * gp) / 100) };
}

// Called right after the deal becomes funded: set the release code hash and tell both sides.
export async function onFunded(c, dealId) {
  const salt = crypto.randomBytes(8).toString('hex');
  const code = releaseCodeFor(dealId);
  await c.query('update deals set release_code_hash = $2, release_code_salt = $3 where id = $1', [dealId, releaseCodeHash(code, salt), salt]);
  const d = await c.one('select * from deals where id = $1', [dealId]);
  await notify(c, d.buyer_id, 'Payment held safely', `Your ${tk(d.amount_paisa)} is held by the app. Only share your release code after you check the item.`, { kind: 'deal', deal_id: d.id });
  await notify(c, d.seller_id, 'Buyer paid', `${tk(d.amount_paisa)} for "${d.title}" is held safely. ${d.handover === 'courier' ? 'Ship it and add the tracking number.' : 'Meet for the handover.'}`, { kind: 'deal', deal_id: d.id });
  await sysMessage(c, d.chat_id, `Payment of ${tk(d.amount_paisa)} is held safely by the app.`, d.id);
}

export const tk = (paisa) => `৳${(Number(paisa) / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export async function afterConfirmed(c, dealId) {
  const deal = await c.one('select * from deals where id = $1', [dealId]);
  const review = await dealVerifier(c, deal);
  const risk = await riskForDeal(c, deal);
  await c.query('update deals set risk_score = $2 where id = $1', [deal.id, risk.score]);
  await c.query(`select transition_deal($1, 'release_queued', null, 'ai', $2)`, [deal.id, `deal_verifier: ${review.recommendation}`]);
  await createAction(c, {
    type: 'release_escrow', subject_type: 'deal', subject_id: deal.id,
    payload: { amount_paisa: deal.amount_paisa, risk_score: risk.score, risk_reasons: risk.reasons },
    ai_review_id: review.id, priority: review.recommendation === 'flag' || risk.score >= 50 ? 1 : 2, requested_by: 'ai:deal_verifier',
  });
  await sysMessage(c, deal.chat_id, 'Handover confirmed. The release is waiting for admin approval.', deal.id);
  await notify(c, deal.seller_id, 'Handover confirmed', `The release of "${deal.title}" is waiting for a quick admin check.`, { kind: 'deal', deal_id: deal.id });
}

// After release / split: queue the seller payout if they have a matching account.
export async function queuePayout(c, dealId) {
  const d = await c.one('select * from deals where id = $1', [dealId]);
  if (!['released', 'split_done'].includes(d.status)) return null;
  if (await c.one(`select 1 from payouts where deal_id = $1 and status in ('queued','approved','sent')`, [d.id])) return null;
  const bal = await c.one(
    `select coalesce(sum(debit_paisa - credit_paisa),0)::bigint b from ledger_entries where deal_id = $1 and account = 'seller_payable'`,
    [d.id],
  );
  if (!bal.b) return null;
  const acct = await c.one(`select * from payout_accounts where user_id = $1 and name_matches_kyc order by created_at desc limit 1`, [d.seller_id]);
  if (!acct) {
    await notify(c, d.seller_id, 'Add a payout account', `You have ${tk(bal.b)} waiting. Add a bKash, Nagad or bank account in your name to get paid.`, { kind: 'payout' });
    return null;
  }
  const po = await c.one(
    `insert into payouts(deal_id, user_id, payout_account_id, amount_paisa, status) values ($1,$2,$3,$4,'queued') returning *`,
    [d.id, d.seller_id, acct.id, bal.b],
  );
  await createAction(c, { type: 'approve_payout', subject_type: 'payout', subject_id: po.id, payload: { deal_id: d.id, amount_paisa: bal.b, method: acct.method, account_last4: acct.account_number.slice(-4) }, priority: 3, requested_by: 'system' });
  return po;
}

export async function analyzeDispute(c, disputeId) {
  const dispute = await c.one('select * from disputes where id = $1', [disputeId]);
  const deal = await c.one('select * from deals where id = $1', [dispute.deal_id]);
  if (deal.status !== 'disputed') throw new HttpError(409, `The deal is ${deal.status}, not in dispute.`);
  const review = await disputeAnalyst(c, dispute, deal);
  const rec = review.recommendation;
  const to = rec === 'refund' ? 'refund_queued' : rec === 'release' ? 'release_queued' : 'split_queued';
  await c.query('select transition_deal($1, $2, null, $3, $4)', [deal.id, to, 'ai', `dispute_analyst: ${rec}`]);
  const buyerPaisa = rec === 'refund' ? deal.amount_paisa : rec === 'release' ? 0 : review.evidence.buyer_paisa ?? Math.round(deal.amount_paisa / 2);
  const type = rec === 'refund' ? 'refund_escrow' : rec === 'release' ? 'release_escrow' : 'split_escrow';
  await createAction(c, {
    type, subject_type: 'deal', subject_id: deal.id,
    payload: { resolves_dispute: true, dispute_id: dispute.id, amount_paisa: deal.amount_paisa, buyer_paisa: buyerPaisa, seller_paisa: deal.amount_paisa - buyerPaisa },
    ai_review_id: review.id, priority: 1, requested_by: 'ai:dispute_analyst',
  });
  await c.query(`update disputes set status = 'ai_reviewed' where id = $1`, [dispute.id]);
  return review;
}

// Admin moves a queued resolution to a different one (e.g. AI said refund, admin wants split).
export async function requeueDispute(c, dealId, to, buyerPaisa, adminId) {
  const deal = await c.one('select * from deals where id = $1 for update', [dealId]);
  const dispute = await c.one('select * from disputes where deal_id = $1', [dealId]);
  if (!dispute) throw new HttpError(400, 'This deal has no dispute.');
  if (['refund_queued', 'release_queued', 'split_queued'].includes(deal.status)) {
    const pend = await c.many(`select id from admin_actions where subject_id = $1 and status = 'pending' and type in ('release_escrow','refund_escrow','split_escrow')`, [dealId]);
    for (const p of pend) await c.query(`update admin_actions set status = 'rejected', decided_by = $2, decided_at = now(), decision_note = 'Replaced by a new resolution' where id = $1`, [p.id, adminId]);
    await c.query(`select transition_deal($1, 'disputed', $2, 'admin', 'Admin re-opened the resolution')`, [dealId, adminId]);
  }
  const st = to === 'refund' ? 'refund_queued' : to === 'release' ? 'release_queued' : 'split_queued';
  await c.query('select transition_deal($1, $2, $3, $4, $5)', [dealId, st, adminId, 'admin', `Admin chose ${to}`]);
  const bp = to === 'refund' ? deal.amount_paisa : to === 'release' ? 0 : Math.max(0, Math.min(deal.amount_paisa, Math.round(Number(buyerPaisa))));
  return createAction(c, {
    type: to === 'refund' ? 'refund_escrow' : to === 'release' ? 'release_escrow' : 'split_escrow', subject_type: 'deal', subject_id: dealId,
    payload: { resolves_dispute: true, dispute_id: dispute.id, amount_paisa: deal.amount_paisa, buyer_paisa: bp, seller_paisa: deal.amount_paisa - bp },
    priority: 1, requested_by: `admin:${adminId}`,
  });
}

// Trust score: 0-100, recomputed after every completed deal and nightly.
export async function computeTrust(c, userId) {
  const u = await c.one('select * from profiles where id = $1', [userId]);
  if (!u) return null;
  const rv = await c.one('select avg(stars)::float avg, count(*)::int n from reviews where reviewee_id = $1', [userId]);
  const lost = await c.one('select count(*)::int n from disputes where loser_id = $1', [userId]);
  const rep = await c.one(`select count(*)::int n from reports where target_user_id = $1 and status = 'upheld'`, [userId]);
  const vou = await c.one('select count(*)::int n from vouches where vouchee_id = $1', [userId]);
  let s = 50;
  s += Math.min(30, u.deals_completed * 3);
  if (rv.n) s += Math.round((rv.avg - 3) * 6);
  s += { none: -10, basic: 0, verified: 8, business: 12 }[u.kyc_level];
  s += Math.min(6, vou.n * 2);
  s -= lost.n * 15 + rep.n * 10;
  s = Math.max(0, Math.min(100, s));
  if (s !== u.trust_score) {
    await c.query('update profiles set trust_score = $2 where id = $1', [userId, s]);
    await c.query('insert into trust_history(user_id, score, reason) values ($1,$2,$3)', [userId, s, 'recomputed']);
  }
  return s;
}

export function badges(p, extra = {}) {
  const b = [];
  if (p.kyc_level === 'verified' || p.kyc_level === 'business') b.push('verified');
  if (p.kyc_level === 'business') b.push('business');
  if (p.deals_completed >= 10) b.push('ten_deals');
  if (extra.avg_stars >= 4.7 && extra.reviews >= 5) b.push('top_rated');
  if (extra.vouches >= 3) b.push('vouched');
  return b;
}

export function publicUser(p) {
  if (!p) return null;
  return {
    id: p.id, display_name: p.display_name, avatar_url: signFile(p.avatar_file), area: p.area, bio: p.bio,
    kyc_level: p.kyc_level, trust_score: p.trust_score, deals_completed: p.deals_completed, shop_name: p.shop_name,
    created_at: p.created_at, badges: badges(p),
  };
}

export function meView(u, admin) {
  return {
    ...publicUser(u), email: u.email, phone: u.phone, locale: u.locale, referral_code: u.referral_code,
    is_admin: !!admin, admin_role: admin?.role || null, delete_requested_at: u.delete_requested_at,
  };
}

// ---- payments: sandbox provider (a real provider plugs in behind the same two calls) ----
export function webhookSignature(body, secret = config.paymentWebhookSecret) {
  return crypto.createHmac('sha256', secret).update(typeof body === 'string' ? body : JSON.stringify(body)).digest('hex');
}

export async function initiatePayment(c, deal) {
  const ref = `sbx_${crypto.randomBytes(9).toString('hex')}`;
  const p = await c.one(
    `insert into payments(deal_id, provider, provider_ref, amount_paisa, status) values ($1,$2,$3,$4,'initiated') returning *`,
    [deal.id, config.paymentProvider, ref, deal.amount_paisa],
  );
  return { payment: p, pay_url: `/pay/${p.id}` };
}

// Idempotent: the same provider_ref can arrive many times.
export async function handlePaymentEvent(evt) {
  return tx(async (c) => {
    const p = await c.one('select * from payments where provider_ref = $1 for update', [evt.provider_ref]);
    if (!p) throw new HttpError(404, 'Unknown payment');
    if (p.status !== 'initiated') return { ok: true, duplicate: true, status: p.status };
    if (Number(evt.amount_paisa) !== Number(p.amount_paisa)) throw new HttpError(400, 'Amount mismatch');
    if (evt.status === 'succeeded') {
      await c.query(`update payments set status = 'succeeded', raw = $2 where id = $1`, [p.id, JSON.stringify(evt)]);
      await c.query('select fund_deal($1, $2)', [p.deal_id, p.id]);
      await onFunded(c, p.deal_id);
    } else {
      await c.query(`update payments set status = 'failed', raw = $2 where id = $1`, [p.id, JSON.stringify(evt)]);
      const d = await c.one('select * from deals where id = $1', [p.deal_id]);
      if (d.status === 'payment_pending') await c.query(`select transition_deal($1, 'accepted', null, 'system', 'Payment failed')`, [d.id]);
      await notify(c, d.buyer_id, 'Payment did not go through', 'Nothing was charged. You can try again from the deal.', { kind: 'deal', deal_id: d.id });
    }
    return { ok: true, duplicate: false };
  });
}

// ---- courier: sandbox provider ----
export async function handleCourierEvent(evt) {
  return tx(async (c) => {
    const d = await c.one('select * from deals where tracking_number = $1 for update', [evt.tracking_number]);
    if (!d) throw new HttpError(404, 'Unknown tracking number');
    if (d.tracking_status === evt.status) return { ok: true, duplicate: true };
    await c.query(`update deals set tracking_status = $2, delivered_at = case when $2 = 'delivered' then coalesce(delivered_at, $3::timestamptz) else delivered_at end where id = $1`, [d.id, evt.status, evt.at || new Date().toISOString()]);
    if (evt.status === 'delivered') {
      const s = await allSettings();
      await c.query(`update deals set auto_release_at = delivered_at + make_interval(hours => $2) where id = $1`, [d.id, Number(s.auto_release_hours)]);
      await notify(c, d.buyer_id, 'Parcel delivered', `Check "${d.title}". If something is wrong, open a dispute within ${s.auto_release_hours} hours, or the payment is released automatically.`, { kind: 'deal', deal_id: d.id });
      await sysMessage(c, d.chat_id, `The courier marked the parcel delivered. Auto-release in ${s.auto_release_hours} hours unless a dispute is opened.`, d.id);
    }
    return { ok: true };
  });
}

export async function dealIsParty(dealId, userId) {
  const d = await one('select * from deals where id = $1', [dealId]);
  if (!d || (d.buyer_id !== userId && d.seller_id !== userId)) throw new HttpError(404, 'Deal not found');
  return d;
}
