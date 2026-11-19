import express from 'express';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { q, one, many, tx } from '../db.js';
import { allSettings } from '../settings.js';
import {
  HttpError, bad, hashPassword, verifyPassword, signToken, requireUser, nidHash, signFile, checkFileSig, verifyToken,
  releaseCodeFor, releaseCodeHash, sha256,
} from '../auth.js';
import { kycVerifier, moderateListing, scamWatch, listingAssistant, supportAgent, normName, HELP, riskForUser } from '../agents.js';
import {
  notify, audit, alert, createAction, sysMessage, fees, tk, afterConfirmed, queuePayout, publicUser, meView, badges,
  initiatePayment, dealIsParty, computeTrust,
} from '../services.js';
import { makePdf } from '../pdf.js';

export const router = express.Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const str = (v, max = 2000) => (v === undefined || v === null ? '' : String(v).trim().slice(0, max));
const paisa = (bdt) => {
  const n = Math.round(Number(bdt) * 100);
  if (!Number.isFinite(n) || n <= 0) throw bad('Enter an amount above zero.');
  return n;
};
const need = (cond, msg) => { if (!cond) throw bad(msg); };
const ipOf = (req) => (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim() || null;

async function adminRow(userId) {
  return one('select * from admin_users where user_id = $1 and active', [userId]);
}
async function ensureBootstrapAdmin(u) {
  if (config.adminEmails.includes(u.email.toLowerCase())) {
    await q(`insert into admin_users(user_id, role) values ($1, 'super_admin') on conflict (user_id) do update set active = true`, [u.id]);
  }
}

// ---------------- auth ----------------
router.post('/auth/register', wrap(async (req, res) => {
  const email = str(req.body.email, 200).toLowerCase();
  const password = String(req.body.password || '');
  const name = str(req.body.name, 80);
  const device = str(req.body.device || req.headers['x-device-id'], 200);
  need(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), 'Enter a valid email.');
  need(password.length >= 8, 'Password needs at least 8 characters.');
  need(name.length >= 2, 'Enter your name.');
  const bl = await one(`select reason from blacklist where (email = $1) or ($2 <> '' and device_fingerprint = $2) limit 1`, [email, device]);
  if (bl) throw new HttpError(403, 'Sign-up is not available for this account or device.', 'blacklisted');
  if (await one('select 1 from profiles where email = $1', [email])) throw new HttpError(409, 'That email already has an account. Sign in instead.', 'exists');
  if (device) {
    const d = await one(`select p.is_banned from devices d join profiles p on p.id = d.user_id where d.device_fingerprint = $1`, [device]);
    if (d?.is_banned) throw new HttpError(403, 'Sign-up is not available on this device.', 'blacklisted');
    if (d && !config.sandbox) throw new HttpError(409, 'This phone already has an account. One account per person.', 'device_used');
  }
  let referredBy = null;
  if (req.body.referral) referredBy = (await one('select id from profiles where referral_code = $1', [str(req.body.referral, 20).toUpperCase()]))?.id || null;
  const u = await tx(async (c) => {
    const u = await c.one(
      `insert into profiles(email, password_hash, display_name, locale, referral_code, referred_by) values ($1,$2,$3,$4,$5,$6) returning *`,
      [email, hashPassword(password), name, req.body.locale === 'en' ? 'en' : 'bn', crypto.randomBytes(4).toString('hex').toUpperCase(), referredBy],
    );
    if (device) await c.query('insert into devices(user_id, device_fingerprint) values ($1,$2) on conflict (device_fingerprint) do nothing', [u.id, device]);
    await audit(c, u.id, 'user', 'register', 'profile', u.id, { device: !!device }, ipOf(req));
    return u;
  });
  await ensureBootstrapAdmin(u);
  res.json({ token: signToken({ sub: u.id, aud: 'user' }), user: meView(u, await adminRow(u.id)) });
}));

router.post('/auth/login', wrap(async (req, res) => {
  const email = str(req.body.email, 200).toLowerCase();
  const u = await one('select * from profiles where email = $1 and deleted_at is null', [email]);
  if (!u || !verifyPassword(String(req.body.password || ''), u.password_hash)) throw new HttpError(401, 'Wrong email or password.');
  if (u.is_banned) throw new HttpError(403, 'This account is suspended.', 'banned');
  await ensureBootstrapAdmin(u);
  const device = str(req.body.device || req.headers['x-device-id'], 200);
  if (device) await q('insert into devices(user_id, device_fingerprint) values ($1,$2) on conflict (device_fingerprint) do nothing', [u.id, device]);
  res.json({ token: signToken({ sub: u.id, aud: 'user' }), user: meView(u, await adminRow(u.id)) });
}));

// ---------------- public bits ----------------
router.get('/config', wrap(async (_req, res) => {
  const s = await allSettings();
  res.json({
    app_name: config.appName, categories: s.categories, sandbox: config.sandbox,
    fees: { platform_fee_percent: s.platform_fee_percent, guarantee_fund_percent: s.guarantee_fund_percent },
    limits: { basic: s.limit_level1, verified: s.limit_level2, business: s.limit_level3, new_user: s.new_user_deal_limit },
    auto_release_hours: s.auto_release_hours, help: HELP,
  });
}));

router.get('/files/:id', wrap(async (req, res) => {
  let allowed = checkFileSig(req.params.id, req.query.exp, req.query.sig);
  if (!allowed) {
    const p = verifyToken((req.headers.authorization || '').slice(7));
    if (p) {
      const f = await one('select owner_id from files where id = $1', [req.params.id]);
      allowed = f && f.owner_id === p.sub;
    }
  }
  if (!allowed) throw new HttpError(403, 'Link expired.');
  const f = await one('select mime, data from files where id = $1', [req.params.id]);
  if (!f) throw new HttpError(404, 'Not found');
  res.set('content-type', f.mime).set('cache-control', 'private, max-age=3000').send(f.data);
}));

// everything below needs a signed-in user
router.use(requireUser);

const MIN_LEVEL = { none: 0, basic: 1, verified: 2, business: 3 };
const needLevel = (u, lvl, what) => {
  if (MIN_LEVEL[u.kyc_level] < MIN_LEVEL[lvl]) throw new HttpError(403, `${what} needs ${lvl === 'basic' ? 'a confirmed phone number' : 'NID verification'} first.`, 'kyc_required');
};

// ---------------- me ----------------
router.get('/me', wrap(async (req, res) => {
  const u = req.user;
  const [kyc, unread, limit] = await Promise.all([
    one('select id, level, status, created_at from kyc_submissions where user_id = $1 order by created_at desc limit 1', [u.id]),
    one('select count(*)::int n from notifications where user_id = $1 and read_at is null', [u.id]),
    one('select user_deal_limit($1) l', [u.id]),
  ]);
  res.json({ user: meView(u, await adminRow(u.id)), kyc, unread_notifications: unread.n, deal_limit_paisa: limit.l });
}));

router.patch('/me', wrap(async (req, res) => {
  const b = req.body;
  const u = await one(
    `update profiles set display_name = coalesce($2, display_name), bio = coalesce($3, bio), area = coalesce($4, area),
      locale = coalesce($5, locale), shop_name = coalesce($6, shop_name), avatar_file = coalesce($7::uuid, avatar_file) where id = $1 returning *`,
    [req.user.id, b.display_name ? str(b.display_name, 80) : null, b.bio !== undefined ? str(b.bio, 300) : null, b.area !== undefined ? str(b.area, 80) : null,
      ['bn', 'en'].includes(b.locale) ? b.locale : null, b.shop_name !== undefined ? str(b.shop_name, 80) : null, b.avatar_file || null],
  );
  res.json({ user: meView(u, await adminRow(u.id)) });
}));

// Level 1 (basic): a phone number that no other account uses. Real SMS OTP plugs in here later.
router.post('/me/phone', wrap(async (req, res) => {
  const phone = str(req.body.phone, 20).replace(/[\s-]/g, '').replace(/^\+?88/, '');
  need(/^01[3-9]\d{8}$/.test(phone), 'Enter a Bangladeshi mobile number like 01712345678.');
  if (await one('select 1 from blacklist where phone = $1', [phone])) throw new HttpError(403, 'This number can\'t be used.', 'blacklisted');
  const taken = await one('select id from profiles where phone = $1 and id <> $2', [phone, req.user.id]);
  if (taken) throw new HttpError(409, 'This number is already on another account.');
  const u = await one(`update profiles set phone = $2, kyc_level = case when kyc_level = 'none' then 'basic'::kyc_level else kyc_level end where id = $1 returning *`, [req.user.id, phone]);
  res.json({ user: meView(u, await adminRow(u.id)) });
}));

router.post('/me/delete', wrap(async (req, res) => {
  const open = await one(`select count(*)::int n from deals where (buyer_id = $1 or seller_id = $1) and status not in ('completed','cancelled','refunded','split_done','paid_out')`, [req.user.id]);
  if (open.n) throw bad('Finish or cancel your open deals before deleting your account.');
  await q('update profiles set delete_requested_at = now() where id = $1', [req.user.id]);
  await q(`update listings set status = 'removed' where seller_id = $1 and status in ('active','paused','pending_review','draft')`, [req.user.id]);
  res.json({ ok: true, note: 'Your account will be deleted in 7 days. Records needed by law (deals, payments) are kept with your name removed.' });
}));

// ---------------- files ----------------
router.post('/files', wrap(async (req, res) => {
  const bucket = str(req.body.bucket, 30);
  const mime = str(req.body.mime, 60) || 'image/jpeg';
  need(['kyc-private', 'deal-proofs', 'listing-photos', 'chat-media', 'avatars', 'evidence'].includes(bucket), 'Unknown bucket');
  need(/^(image\/(jpeg|png|webp)|audio\/(m4a|mp4|mpeg|webm|aac)|application\/pdf)$/.test(mime), 'That file type is not allowed.');
  const data = Buffer.from(String(req.body.data || '').replace(/^data:[^,]+,/, ''), 'base64');
  need(data.length > 100, 'The file is empty.');
  need(data.length <= 6 * 1024 * 1024, 'Files must be under 6 MB.');
  const source = ['camera', 'gallery', 'web'].includes(req.body.source) ? req.body.source : 'unknown';
  const f = await one('insert into files(bucket, owner_id, mime, bytes, data, source) values ($1,$2,$3,$4,$5,$6) returning id, source', [bucket, req.user.id, mime, data.length, data, source]);
  res.json({ id: f.id, url: signFile(f.id) });
}));
const ownFile = async (id, userId, bucket) => {
  if (!id) return null;
  const f = await one('select id, owner_id, bucket, source from files where id = $1', [id]);
  if (!f || f.owner_id !== userId || (bucket && f.bucket !== bucket)) throw bad('A photo is missing or was not uploaded by you.');
  return f;
};

// ---------------- KYC ----------------
router.get('/kyc', wrap(async (req, res) => {
  const rows = await many('select id, level, status, nid_number_last4, full_name_en, liveness_passed, created_at from kyc_submissions where user_id = $1 order by created_at desc limit 5', [req.user.id]);
  res.json({ submissions: rows, level: req.user.kyc_level });
}));

router.post('/kyc', wrap(async (req, res) => {
  const u = req.user;
  needLevel(u, 'basic', 'NID verification');
  const b = req.body;
  const nid = str(b.nid_number, 30).replace(/\D/g, '');
  need(nid.length >= 10, 'Enter your NID number.');
  need(str(b.full_name_en, 120).length >= 3, 'Enter your name as on the NID (English).');
  need(/^\d{4}-\d{2}-\d{2}$/.test(str(b.date_of_birth, 10)), 'Enter your date of birth.');
  const [front, back, selfie, turn] = await Promise.all([
    ownFile(b.nid_front, u.id, 'kyc-private'), ownFile(b.nid_back, u.id, 'kyc-private'), ownFile(b.selfie, u.id, 'kyc-private'), ownFile(b.selfie_turn, u.id, 'kyc-private'),
  ]);
  need(front && back && selfie, 'Add the NID front, back and a selfie.');
  const pending = await one(`select 1 from kyc_submissions where user_id = $1 and level = 'verified' and status in ('pending','ai_checked')`, [u.id]);
  if (pending) throw new HttpError(409, 'Your verification is already being reviewed.');
  // liveness: both selfies from the live camera, taken a few seconds apart, in two poses
  const liveness = !!(turn && b.liveness?.straight && b.liveness?.turned && selfie.source !== 'gallery' && turn.source !== 'gallery');
  const result = await tx(async (c) => {
    const sub = await c.one(
      `insert into kyc_submissions(user_id, level, nid_number_hash, nid_number_last4, full_name_en, full_name_bn, date_of_birth, nid_front_path, nid_back_path, selfie_path, selfie_turn_path, liveness_passed)
       values ($1,'verified',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning *`,
      [u.id, nidHash(nid), nid.slice(-4), str(b.full_name_en, 120), str(b.full_name_bn, 120) || null, b.date_of_birth, front.id, back.id, selfie.id, turn?.id || null, liveness],
    );
    sub._nid_plain = nid;
    const v = await kycVerifier(c, sub, u);
    await c.query(`update kyc_submissions set status = 'ai_checked', face_match_score = $2, ocr_json = $3 where id = $1`, [sub.id, v.faceScore, v.ocr ? JSON.stringify(v.ocr) : null]);
    const type = v.review.recommendation === 'reject' ? 'reject_kyc' : 'approve_kyc';
    const action = await createAction(c, {
      type, subject_type: 'kyc', subject_id: sub.id, payload: { user_id: u.id, level: 'verified', resubmit: !v.blacklisted && !v.duplicateUserId },
      ai_review_id: v.review.id, priority: v.review.recommendation === 'approve' ? 3 : 2, requested_by: 'ai:kyc_verifier',
    });
    if (v.duplicateUserId || v.blacklisted) {
      await alert(c, { kind: 'duplicate_nid', priority: 1, subject_type: 'profile', subject_id: u.id, title: v.blacklisted ? 'Blacklisted NID tried to sign up' : 'Same NID on two accounts', body: `${u.email} used an NID that ${v.blacklisted ? 'is blacklisted' : 'is on another account'}.`, data: { other_user_id: v.duplicateUserId } });
    }
    await audit(c, u.id, 'user', 'kyc_submit', 'kyc', sub.id, { liveness }, ipOf(req));
    return { submission_id: sub.id, status: 'ai_checked', action_id: action.id };
  });
  res.json({ ...result, message: 'Thanks! Your documents are being checked. This usually takes a few hours.' });
}));

router.post('/kyc/business', wrap(async (req, res) => {
  const u = req.user;
  needLevel(u, 'verified', 'A business badge');
  const lic = str(req.body.trade_licence_no, 40);
  need(lic.length >= 4, 'Enter your trade licence number.');
  const photo = await ownFile(req.body.licence_photo, u.id, 'kyc-private');
  need(photo, 'Add a photo of your trade licence.');
  const base = await one(`select * from kyc_submissions where user_id = $1 and status = 'approved' order by created_at desc limit 1`, [u.id]);
  need(base, 'Your NID verification must be approved first.');
  const out = await tx(async (c) => {
    const sub = await c.one(
      `insert into kyc_submissions(user_id, level, nid_number_hash, nid_number_last4, full_name_en, date_of_birth, nid_front_path, nid_back_path, selfie_path, liveness_passed, trade_licence_no, status)
       values ($1,'business',$2,$3,$4,$5,$6,$7,$8,true,$9,'ai_checked') returning *`,
      [u.id, base.nid_number_hash, base.nid_number_last4, base.full_name_en, base.date_of_birth, photo.id, base.nid_back_path, base.selfie_path, lic],
    );
    if (req.body.shop_name) await c.query('update profiles set shop_name = $2 where id = $1', [u.id, str(req.body.shop_name, 80)]);
    const r = await c.one(
      `insert into ai_reviews(agent, subject_type, subject_id, recommendation, confidence, risk_score, summary, evidence, model) values ('kyc_verifier','kyc',$1,'flag',0.6,20,$2,$3,'rules') returning id`,
      [sub.id, 'Business upgrade: check the trade licence photo and number by eye.', JSON.stringify({ checks: [{ name: 'NID already approved', pass: true, detail: base.full_name_en }, { name: 'Trade licence number', pass: true, detail: lic }] })],
    );
    return createAction(c, { type: 'approve_kyc', subject_type: 'kyc', subject_id: sub.id, payload: { user_id: u.id, level: 'business' }, ai_review_id: r.id, priority: 3, requested_by: 'user' });
  });
  res.json({ ok: true, action_id: out.id, message: 'Sent for review.' });
}));

// ---------------- payout accounts ----------------
router.get('/payout-accounts', wrap(async (req, res) => {
  const rows = await many('select id, method, account_number, account_name, name_matches_kyc, created_at from payout_accounts where user_id = $1 order by created_at desc', [req.user.id]);
  res.json({ accounts: rows.map((r) => ({ ...r, account_number: `****${r.account_number.slice(-4)}` })) });
}));
router.post('/payout-accounts', wrap(async (req, res) => {
  const u = req.user;
  needLevel(u, 'verified', 'Getting paid');
  const method = str(req.body.method, 10);
  need(['bkash', 'nagad', 'bank'].includes(method), 'Choose bKash, Nagad or bank.');
  const number = str(req.body.account_number, 40).replace(/[\s-]/g, '');
  need(method === 'bank' ? number.length >= 8 : /^01[3-9]\d{8}$/.test(number), method === 'bank' ? 'Enter the bank account number.' : 'Enter the wallet number like 01712345678.');
  const name = str(req.body.account_name, 120);
  need(name.length >= 3, 'Enter the name on the account.');
  if (await one('select 1 from blacklist where payout_account_number = $1', [number])) throw new HttpError(403, 'This account can\'t be used.', 'blacklisted');
  const kyc = await one(`select full_name_en from kyc_submissions where user_id = $1 and status = 'approved' order by created_at desc limit 1`, [u.id]);
  const matches = !!kyc && normName(kyc.full_name_en) === normName(name);
  const out = await tx(async (c) => {
    const a = await c.one('insert into payout_accounts(user_id, method, account_number, account_name, name_matches_kyc, verified_at) values ($1,$2,$3,$4,$5, case when $5 then now() end) returning *', [u.id, method, number, name, matches]);
    if (matches) {
      const waiting = await c.many(`select d.id from deals d where d.seller_id = $1 and d.status in ('released','split_done') and not exists (select 1 from payouts p where p.deal_id = d.id)`, [u.id]);
      for (const w of waiting) await queuePayout(c, w.id);
    }
    return a;
  });
  res.json({
    account: { ...out, account_number: `****${number.slice(-4)}` },
    message: matches ? 'Saved. Payouts will go here.' : 'Saved, but the name does not match your verified NID name, so payouts to it are blocked.',
  });
}));

// ---------------- listings ----------------
const listingOut = (l, photos = [], seller = null, saved = false) => ({
  ...l, photos: photos.map((p) => ({ id: p.path, url: signFile(p.path) })), seller: seller ? publicUser(seller) : undefined, saved,
});

router.get('/listings', wrap(async (req, res) => {
  const where = [`l.status = 'active'`, 'not p.is_banned'];
  const params = [];
  const add = (sql, v) => { params.push(v); where.push(sql.replace('?', `$${params.length}`)); };
  if (req.query.q) add(`(l.title ilike ? or l.description ilike $${params.length + 1})`, `%${str(req.query.q, 80)}%`);
  if (req.query.category) add('l.category = ?', str(req.query.category, 60));
  if (req.query.area) add('l.location_area ilike ?', `%${str(req.query.area, 60)}%`);
  if (req.query.min) add('l.price_paisa >= ?', paisa(req.query.min));
  if (req.query.max) add('l.price_paisa <= ?', paisa(req.query.max));
  if (req.query.seller) { where.shift(); where.unshift(`l.status in ('active','sold')`); add('l.seller_id = ?', str(req.query.seller, 40)); }
  if (req.query.verified === '1') where.push(`p.kyc_level in ('verified','business')`);
  const order = { price_asc: 'l.price_paisa asc', price_desc: 'l.price_paisa desc', trust: 'p.trust_score desc, l.created_at desc' }[req.query.sort] || 'l.created_at desc';
  params.push(req.user.id);
  const rows = await many(
    `select l.*, row_to_json(p.*) seller, (select path from listing_photos where listing_id = l.id order by position limit 1) photo,
      exists(select 1 from saved_listings s where s.listing_id = l.id and s.user_id = $${params.length}) saved
     from listings l join profiles p on p.id = l.seller_id where ${where.join(' and ')} order by ${order} limit 60`,
    params,
  );
  res.json({ listings: rows.map((r) => ({ ...listingOut(r, r.photo ? [{ path: r.photo }] : [], r.seller, r.saved), seller: publicUser(r.seller) })) });
}));

router.get('/listings/mine', wrap(async (req, res) => {
  const rows = await many(`select l.*, (select path from listing_photos where listing_id = l.id order by position limit 1) photo from listings l where seller_id = $1 and status <> 'removed' order by created_at desc`, [req.user.id]);
  res.json({ listings: rows.map((r) => listingOut(r, r.photo ? [{ path: r.photo }] : [])) });
}));

router.get('/listings/:id', wrap(async (req, res) => {
  const l = await one('select * from listings where id = $1', [req.params.id]);
  if (!l || (l.status !== 'active' && l.status !== 'sold' && l.seller_id !== req.user.id)) throw new HttpError(404, 'This listing is not available.');
  const [photos, seller, saved, rv] = await Promise.all([
    many('select path from listing_photos where listing_id = $1 order by position', [l.id]),
    one('select * from profiles where id = $1', [l.seller_id]),
    one('select 1 from saved_listings where user_id = $1 and listing_id = $2', [req.user.id, l.id]),
    one('select round(avg(stars)::numeric,1)::float avg, count(*)::int n from reviews where reviewee_id = $1', [l.seller_id]),
  ]);
  res.json({ listing: { ...listingOut(l, photos, seller, !!saved), seller_rating: rv } });
}));

router.post('/listings', wrap(async (req, res) => {
  const u = req.user;
  needLevel(u, 'basic', 'Selling');
  const b = req.body;
  const s = await allSettings();
  const title = str(b.title, 90), description = str(b.description, 3000), category = str(b.category, 60);
  need(title.length >= 3, 'Add a title.');
  need(description.length >= 10, 'Add a short description.');
  need((s.categories || []).includes(category), 'Pick a category.');
  const price = paisa(b.price);
  const photos = Array.isArray(b.photos) ? b.photos.slice(0, 8) : [];
  need(photos.length >= 1, 'Add at least one photo.');
  for (const p of photos) await ownFile(p, u.id, 'listing-photos');
  const out = await tx(async (c) => {
    const l = await c.one(
      `insert into listings(seller_id, title, description, category, price_paisa, deal_type, condition, location_area, return_days, status)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending_review') returning *`,
      [u.id, title, description, category, price, ['sale', 'service', 'rental', 'trade'].includes(b.deal_type) ? b.deal_type : 'sale', str(b.condition, 40) || null, str(b.location_area, 80) || u.area, Math.max(0, Math.min(30, Number(b.return_days) || 0))],
    );
    for (const [i, p] of photos.entries()) await c.query('insert into listing_photos(listing_id, path, position) values ($1,$2,$3)', [l.id, p, i]);
    const m = await moderateListing(c, l);
    if (m.ok) await c.query(`update listings set status = 'active' where id = $1`, [l.id]);
    else await createAction(c, { type: 'remove_listing', subject_type: 'listing', subject_id: l.id, payload: { issues: m.issues, title }, ai_review_id: m.review.id, priority: 2, requested_by: 'ai:moderator' });
    return { ...l, status: m.ok ? 'active' : 'pending_review', issues: m.issues };
  });
  res.json({ listing: out, message: out.status === 'active' ? 'Your listing is live.' : 'Your listing is being checked by our team before it goes live.' });
}));

router.patch('/listings/:id', wrap(async (req, res) => {
  const l = await one('select * from listings where id = $1 and seller_id = $2', [req.params.id, req.user.id]);
  if (!l) throw new HttpError(404, 'Listing not found');
  const status = req.body.status;
  if (status) {
    need(['active', 'paused', 'sold'].includes(status), 'Unknown status');
    need(l.status !== 'removed' && l.status !== 'pending_review', 'This listing is under review.');
  }
  const r = await one(
    `update listings set status = coalesce($2::listing_status, status), price_paisa = coalesce($3, price_paisa), description = coalesce($4, description), title = coalesce($5, title) where id = $1 returning *`,
    [l.id, status || null, req.body.price ? paisa(req.body.price) : null, req.body.description ? str(req.body.description, 3000) : null, req.body.title ? str(req.body.title, 90) : null],
  );
  res.json({ listing: r });
}));

router.post('/listings/assist', wrap(async (req, res) => {
  res.json(await listingAssistant({ title: str(req.body.title, 120), hints: str(req.body.hints, 600), category: str(req.body.category, 60), condition: str(req.body.condition, 40) }));
}));

router.post('/listings/:id/save', wrap(async (req, res) => {
  const ex = await one('delete from saved_listings where user_id = $1 and listing_id = $2 returning 1', [req.user.id, req.params.id]);
  if (!ex) await q('insert into saved_listings(user_id, listing_id) values ($1,$2) on conflict do nothing', [req.user.id, req.params.id]);
  res.json({ saved: !ex });
}));
router.get('/saved', wrap(async (req, res) => {
  const rows = await many(
    `select l.*, (select path from listing_photos where listing_id = l.id order by position limit 1) photo from saved_listings s join listings l on l.id = s.listing_id where s.user_id = $1 and l.status in ('active','sold') order by s.created_at desc`,
    [req.user.id],
  );
  res.json({ listings: rows.map((r) => listingOut(r, r.photo ? [{ path: r.photo }] : [], null, true)) });
}));

// ---------------- wanted posts ----------------
router.get('/wanted', wrap(async (req, res) => {
  const rows = await many(`select w.*, row_to_json(p.*) u from wanted_posts w join profiles p on p.id = w.user_id where w.status = 'open' and not p.is_banned order by w.created_at desc limit 50`);
  res.json({ wanted: rows.map((r) => ({ ...r, u: undefined, user: publicUser(r.u) })) });
}));
router.post('/wanted', wrap(async (req, res) => {
  needLevel(req.user, 'basic', 'Posting');
  const title = str(req.body.title, 90);
  need(title.length >= 3, 'What are you looking for?');
  const w = await one('insert into wanted_posts(user_id, title, details, max_price_paisa, category, area) values ($1,$2,$3,$4,$5,$6) returning *', [req.user.id, title, str(req.body.details, 600) || null, req.body.max_price ? paisa(req.body.max_price) : null, str(req.body.category, 60) || null, str(req.body.area, 80) || null]);
  res.json({ wanted: w });
}));
router.delete('/wanted/:id', wrap(async (req, res) => {
  await q(`update wanted_posts set status = 'closed' where id = $1 and user_id = $2`, [req.params.id, req.user.id]);
  res.json({ ok: true });
}));

// ---------------- profiles, reviews, vouches, reports ----------------
router.get('/users/:id', wrap(async (req, res) => {
  const p = await one('select * from profiles where id = $1 and deleted_at is null', [req.params.id]);
  if (!p) throw new HttpError(404, 'User not found');
  const [rv, reviews, vouches, vouched] = await Promise.all([
    one('select round(avg(stars)::numeric,1)::float avg, count(*)::int n from reviews where reviewee_id = $1', [p.id]),
    many('select r.stars, r.comment, r.created_at, pr.display_name reviewer from reviews r join profiles pr on pr.id = r.reviewer_id where r.reviewee_id = $1 order by r.created_at desc limit 20', [p.id]),
    one('select count(*)::int n from vouches where vouchee_id = $1', [p.id]),
    one('select 1 from vouches where voucher_id = $1 and vouchee_id = $2', [req.user.id, p.id]),
  ]);
  res.json({ user: { ...publicUser(p), badges: badges(p, { avg_stars: rv.avg, reviews: rv.n, vouches: vouches.n }), is_banned: p.is_banned }, rating: rv, reviews, vouches: vouches.n, i_vouched: !!vouched });
}));

router.post('/users/:id/vouch', wrap(async (req, res) => {
  needLevel(req.user, 'verified', 'Vouching');
  need(req.params.id !== req.user.id, 'You can\'t vouch for yourself.');
  const dealt = await one(`select 1 from deals where status = 'completed' and ((buyer_id = $1 and seller_id = $2) or (buyer_id = $2 and seller_id = $1))`, [req.user.id, req.params.id]);
  need(dealt, 'You can vouch after you complete a deal with this person.');
  await q('insert into vouches(voucher_id, vouchee_id, note) values ($1,$2,$3) on conflict do nothing', [req.user.id, req.params.id, str(req.body.note, 200) || null]);
  await tx((c) => computeTrust(c, req.params.id));
  res.json({ ok: true });
}));

router.post('/reports', wrap(async (req, res) => {
  const reason = str(req.body.reason, 500);
  need(reason.length >= 3, 'Tell us what happened.');
  const r = await tx(async (c) => {
    const r = await c.one('insert into reports(reporter_id, target_user_id, target_listing_id, target_message_id, reason) values ($1,$2,$3,$4,$5) returning *', [req.user.id, req.body.user_id || null, req.body.listing_id || null, req.body.message_id || null, reason]);
    const n = req.body.user_id ? await c.one(`select count(distinct reporter_id)::int n from reports where target_user_id = $1 and status = 'open'`, [req.body.user_id]) : { n: 0 };
    if (n.n >= 3) await alert(c, { kind: 'reports', priority: 2, subject_type: 'profile', subject_id: req.body.user_id, title: `${n.n} people reported the same user`, body: reason });
    return r;
  });
  res.json({ ok: true, id: r.id, message: 'Thanks. Our team will look at it.' });
}));

// ---------------- chats ----------------
async function chatMember(chatId, userId) {
  const m = await one('select 1 from chat_members where chat_id = $1 and user_id = $2', [chatId, userId]);
  if (!m) throw new HttpError(404, 'Chat not found');
}

router.post('/chats', wrap(async (req, res) => {
  const u = req.user;
  needLevel(u, 'basic', 'Chatting');
  let otherId = req.body.user_id, listingId = req.body.listing_id || null;
  if (listingId) {
    const l = await one('select seller_id, status from listings where id = $1', [listingId]);
    if (!l || l.status !== 'active') throw bad('This listing is not available.');
    otherId = l.seller_id;
  }
  need(otherId && otherId !== u.id, 'Pick someone to chat with.');
  const other = await one('select * from profiles where id = $1 and not is_banned and deleted_at is null', [otherId]);
  need(other, 'This person is not available.');
  need(other.kyc_level !== 'none', 'This person has not confirmed their phone yet.');
  const existing = await one(
    `select c.id from chats c join chat_members a on a.chat_id = c.id and a.user_id = $1 join chat_members b on b.chat_id = c.id and b.user_id = $2 where c.listing_id is not distinct from $3 limit 1`,
    [u.id, otherId, listingId],
  );
  if (existing) return res.json({ chat_id: existing.id });
  const id = await tx(async (c) => {
    const ch = await c.one('insert into chats(listing_id) values ($1) returning id', [listingId]);
    await c.query('insert into chat_members(chat_id, user_id) values ($1,$2),($1,$3)', [ch.id, u.id, otherId]);
    await sysMessage(c, ch.id, 'Keep all talk and payment in the app. Your money is only protected here.');
    return ch.id;
  });
  res.json({ chat_id: id });
}));

router.get('/chats', wrap(async (req, res) => {
  const rows = await many(
    `select c.id, c.listing_id, l.title listing_title, l.price_paisa listing_price,
       (select path from listing_photos where listing_id = l.id order by position limit 1) listing_photo,
       row_to_json(o.*) other, m.body last_body, m.kind last_kind, m.created_at last_at, m.sender_id last_sender,
       (select count(*)::int from messages x where x.chat_id = c.id and x.created_at > coalesce(me.last_read_at, 'epoch') and x.sender_id is distinct from $1) unread
     from chat_members me join chats c on c.id = me.chat_id
     join chat_members om on om.chat_id = c.id and om.user_id <> $1 join profiles o on o.id = om.user_id
     left join listings l on l.id = c.listing_id
     left join lateral (select body, kind, created_at, sender_id from messages where chat_id = c.id order by created_at desc limit 1) m on true
     where me.user_id = $1 order by coalesce(m.created_at, c.created_at) desc limit 100`,
    [req.user.id],
  );
  res.json({ chats: rows.map((r) => ({ ...r, other: publicUser(r.other), listing_photo: signFile(r.listing_photo) })) });
}));

const msgOut = (m) => ({ ...m, media_url: signFile(m.media_path) });
router.get('/chats/:id', wrap(async (req, res) => {
  await chatMember(req.params.id, req.user.id);
  const [chat, other, msgs, deals] = await Promise.all([
    one('select c.*, l.title listing_title, l.price_paisa listing_price, l.seller_id listing_seller, l.status listing_status from chats c left join listings l on l.id = c.listing_id where c.id = $1', [req.params.id]),
    one('select p.* from chat_members m join profiles p on p.id = m.user_id where m.chat_id = $1 and m.user_id <> $2', [req.params.id, req.user.id]),
    many(`select * from (select * from messages where chat_id = $1 ${req.query.after ? 'and created_at > $2' : ''} order by created_at desc limit 200) x order by created_at`, req.query.after ? [req.params.id, req.query.after] : [req.params.id]),
    many('select id, status, title, amount_paisa, buyer_id, seller_id, proposed_by, handover, created_at from deals where chat_id = $1 order by created_at', [req.params.id]),
  ]);
  await q('update chat_members set last_read_at = now() where chat_id = $1 and user_id = $2', [req.params.id, req.user.id]);
  res.json({ chat, other: publicUser(other), messages: msgs.map(msgOut), deals });
}));

router.post('/chats/:id/messages', wrap(async (req, res) => {
  await chatMember(req.params.id, req.user.id);
  const kind = ['text', 'image', 'voice'].includes(req.body.kind) ? req.body.kind : 'text';
  const body = str(req.body.body, 2000);
  let media = null;
  if (kind !== 'text') media = (await ownFile(req.body.media, req.user.id, 'chat-media'))?.id;
  need(kind === 'text' ? body.length > 0 : media, 'Type a message.');
  const s = await allSettings();
  const flag = kind === 'text' ? scamWatch(body, s.banned_words) : null;
  const m = await one(`insert into messages(chat_id, sender_id, kind, body, media_path, ai_flag) values ($1,$2,$3,$4,$5,$6) returning *`, [req.params.id, req.user.id, kind, body || null, media, flag]);
  if (flag) {
    const recent = await one(`select count(*)::int n from messages where sender_id = $1 and ai_flag is not null and created_at > now() - interval '1 day'`, [req.user.id]);
    if (recent.n >= 3) await tx((c) => alert(c, { kind: 'scam_watch', priority: 2, subject_type: 'profile', subject_id: req.user.id, title: 'Repeated scam patterns in chat', body: `${req.user.display_name}: ${recent.n} flagged messages today. Last: "${body.slice(0, 120)}"` }));
  }
  const other = await one('select user_id from chat_members where chat_id = $1 and user_id <> $2', [req.params.id, req.user.id]);
  if (other) await q(`insert into notifications(user_id, title, body, data) values ($1,$2,$3,$4)`, [other.user_id, req.user.display_name, kind === 'text' ? body.slice(0, 120) : kind === 'image' ? 'Sent a photo' : 'Sent a voice note', JSON.stringify({ kind: 'chat', chat_id: req.params.id })]);
  res.json({ message: msgOut(m) });
}));

// ---------------- deals ----------------
async function dealView(d, viewer) {
  const [events, proofs, dispute, contract, buyer, seller, reviews, payout, trip] = await Promise.all([
    many('select from_status, to_status, actor_kind, note, created_at from deal_events where deal_id = $1 order by id', [d.id]),
    many('select id, user_id, stage, lat, lng, accuracy_m, is_mock_location, source, captured_at, selfie_path, item_photo_paths from deal_proofs where deal_id = $1 order by captured_at', [d.id]),
    one('select * from disputes where deal_id = $1', [d.id]),
    one('select id, file_id, content_hash, buyer_signed_at, seller_signed_at from e_contracts where deal_id = $1', [d.id]),
    one('select * from profiles where id = $1', [d.buyer_id]),
    one('select * from profiles where id = $1', [d.seller_id]),
    many('select reviewer_id, stars, comment from reviews where deal_id = $1', [d.id]),
    one('select status, amount_paisa, created_at from payouts where deal_id = $1 order by created_at desc limit 1', [d.id]),
    one('select share_token, expires_at from trip_shares where deal_id = $1 and user_id = $2 and expires_at > now() order by created_at desc limit 1', [d.id, viewer]),
  ]);
  const role = viewer === d.buyer_id ? 'buyer' : 'seller';
  const showCode = role === 'buyer' && ['funded', 'handover_pending', 'shipped'].includes(d.status) && !d.release_code_locked && d.handover !== 'courier';
  const evidence = dispute ? await many('select user_id, note, media_paths, created_at from dispute_evidence where dispute_id = $1 order by created_at', [dispute.id]) : [];
  const seller_net = d.amount_paisa - d.fee_paisa - d.guarantee_paisa;
  return {
    ...d, release_code_hash: undefined, release_code_salt: undefined, role,
    release_code: showCode ? releaseCodeFor(d.id) : null,
    seller_net_paisa: seller_net,
    buyer: publicUser(buyer), seller: publicUser(seller), events,
    proofs: proofs.map((p) => ({ ...p, mine: p.user_id === viewer, selfie_url: p.user_id === viewer ? signFile(p.selfie_path) : null, selfie_path: undefined, item_photo_paths: undefined })),
    dispute: dispute ? { ...dispute, evidence: evidence.map((e) => ({ ...e, mine: e.user_id === viewer, media: (e.media_paths || []).map((m) => signFile(m)) })) } : null,
    contract: contract ? { ...contract, url: signFile(contract.file_id) } : null,
    my_review: reviews.find((r) => r.reviewer_id === viewer) || null,
    payout: role === 'seller' ? payout : null,
    trip: trip ? { url: `/trip/${trip.share_token}`, expires_at: trip.expires_at } : null,
  };
}

router.get('/deals', wrap(async (req, res) => {
  const rows = await many(
    `select d.id, d.title, d.status, d.amount_paisa, d.handover, d.created_at, d.buyer_id, d.seller_id, d.chat_id,
       row_to_json(o.*) other from deals d join profiles o on o.id = case when d.buyer_id = $1 then d.seller_id else d.buyer_id end
     where d.buyer_id = $1 or d.seller_id = $1 order by d.created_at desc limit 100`,
    [req.user.id],
  );
  res.json({ deals: rows.map((r) => ({ ...r, role: r.buyer_id === req.user.id ? 'buyer' : 'seller', other: publicUser(r.other) })) });
}));

router.get('/deals/:id', wrap(async (req, res) => {
  const d = await dealIsParty(req.params.id, req.user.id);
  res.json({ deal: await dealView(d, req.user.id) });
}));

router.post('/deals', wrap(async (req, res) => {
  const u = req.user;
  needLevel(u, 'basic', 'Making a deal');
  const b = req.body;
  await chatMember(b.chat_id, u.id);
  const other = await one('select user_id from chat_members where chat_id = $1 and user_id <> $2', [b.chat_id, u.id]);
  const chat = await one('select * from chats where id = $1', [b.chat_id]);
  const role = b.role === 'seller' ? 'seller' : 'buyer';
  const amount = paisa(b.amount);
  const handover = ['meetup', 'courier', 'pickup_point', 'digital'].includes(b.handover) ? b.handover : 'meetup';
  const title = str(b.title, 120) || (chat.listing_id ? (await one('select title from listings where id = $1', [chat.listing_id])).title : '');
  need(title.length >= 2, 'Add what the deal is for.');
  const terms = str(b.terms, 2000) || 'Item as described in the chat.';
  const f = await fees(amount);
  const buyer = role === 'buyer' ? u.id : other.user_id, seller = role === 'seller' ? u.id : other.user_id;
  const lim = await one('select user_deal_limit($1) a, user_deal_limit($2) b', [buyer, seller]);
  if (amount > Math.min(lim.a, lim.b)) throw new HttpError(403, `This amount is above the limit for one of you (${tk(Math.min(lim.a, lim.b))}). Verify your NID to raise it.`, 'limit');
  const d = await tx(async (c) => {
    if (b.replaces_deal_id) {
      const old = await c.one('select * from deals where id = $1 and chat_id = $2', [b.replaces_deal_id, b.chat_id]);
      if (old && old.status === 'proposed') await c.query(`select transition_deal($1, 'cancelled', $2, 'user', 'Countered with a new offer')`, [old.id, u.id]);
    }
    const d = await c.one(
      `insert into deals(listing_id, chat_id, buyer_id, seller_id, proposed_by, deal_type, title, terms, amount_paisa, fee_paisa, guarantee_paisa, fee_percent, guarantee_percent, handover, return_days, replaces_deal_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) returning *`,
      [chat.listing_id, chat.id, buyer, seller, u.id, ['sale', 'service', 'rental', 'trade'].includes(b.deal_type) ? b.deal_type : 'sale', title, terms, amount, f.fee_paisa, f.guarantee_paisa, f.fee_percent, f.guarantee_percent, handover, Math.max(0, Math.min(30, Number(b.return_days) || 0)), b.replaces_deal_id || null],
    );
    await c.query(`insert into deal_events(deal_id, actor_id, actor_kind, to_status, note) values ($1,$2,'user','proposed',$3)`, [d.id, u.id, b.replaces_deal_id ? 'Counter offer' : 'Deal proposed']);
    await c.query(`insert into messages(chat_id, sender_id, kind, body, deal_id) values ($1,$2,'deal_card',$3,$4)`, [chat.id, u.id, `${title} · ${tk(amount)}`, d.id]);
    await notify(c, other.user_id, 'New deal offer', `${u.display_name} offered ${tk(amount)} for "${title}".`, { kind: 'deal', deal_id: d.id });
    return d;
  });
  res.json({ deal: await dealView(d, u.id) });
}));

async function dealAction(req, fn) {
  const d = await dealIsParty(req.params.id, req.user.id);
  try {
    await tx((c) => fn(c, d));
  } catch (e) {
    if (e.code === 'P0002' || e.code === 'P0003' || e.code === 'P0004') throw new HttpError(409, e.message.replace(/^\w+: /, ''), e.code);
    throw e;
  }
  return dealView(await one('select * from deals where id = $1', [d.id]), req.user.id);
}
const trans = (c, d, to, actor, note) => c.query('select transition_deal($1, $2, $3, $4, $5)', [d.id, to, actor, 'user', note || null]);

function contractPdf(d, buyer, seller) {
  return makePdf([
    { text: `${config.appName} - Deal agreement`, size: 18, bold: true },
    { text: `Deal ID: ${d.id}`, size: 9, gap: 8 },
    { text: `Date: ${new Date().toISOString().slice(0, 10)}`, size: 9 },
    { text: 'Parties', size: 12, bold: true, gap: 14 },
    { text: `Buyer: ${buyer.display_name} (${buyer.kyc_level})` },
    { text: `Seller: ${seller.display_name} (${seller.kyc_level})` },
    { text: 'What is agreed', size: 12, bold: true, gap: 14 },
    { text: `Item or service: ${d.title}` },
    { text: `Type: ${d.deal_type}. Handover: ${d.handover}. Return window: ${d.return_days} days.` },
    { text: `Terms: ${d.terms}` },
    { text: 'Money', size: 12, bold: true, gap: 14 },
    { text: `Amount: BDT ${(d.amount_paisa / 100).toFixed(2)}` },
    { text: `Platform fee (${d.fee_percent}%): BDT ${(d.fee_paisa / 100).toFixed(2)}. Guarantee fund (${d.guarantee_percent}%): BDT ${(d.guarantee_paisa / 100).toFixed(2)}.` },
    { text: `Seller receives: BDT ${((d.amount_paisa - d.fee_paisa - d.guarantee_paisa) / 100).toFixed(2)}` },
    { text: 'How it works', size: 12, bold: true, gap: 14 },
    { text: `1. The buyer pays the app. The money is held, not sent to the seller.\n2. At handover both sides save a selfie with GPS, or the seller adds courier tracking.\n3. The buyer confirms or shares the release code. An admin approves the release.\n4. Either side may open a dispute before release. An admin decides refund, release or split.` },
    { text: 'Both parties sign by tapping "Sign" in the app. The SHA-256 hash of this file is stored with the deal so it can\'t be changed later.', size: 9, gap: 14 },
  ], { title: `${config.appName} agreement ${d.id.slice(0, 8)}` });
}

router.post('/deals/:id/accept', wrap(async (req, res) => {
  res.json({ deal: await dealAction(req, async (c, d) => {
    await trans(c, d, 'accepted', req.user.id, 'Deal accepted');
    const [buyer, seller] = await Promise.all([c.one('select * from profiles where id = $1', [d.buyer_id]), c.one('select * from profiles where id = $1', [d.seller_id])]);
    const pdf = contractPdf(d, buyer, seller);
    const f = await c.one(`insert into files(bucket, owner_id, mime, bytes, data, source) values ('documents', null, 'application/pdf', $1, $2, 'generated') returning id`, [pdf.length, pdf]);
    await c.query('insert into e_contracts(deal_id, file_id, content_hash) values ($1,$2,$3) on conflict (deal_id) do nothing', [d.id, f.id, sha256(pdf)]);
    await sysMessage(c, d.chat_id, `Deal accepted: ${d.title} for ${tk(d.amount_paisa)}. The buyer can pay now.`, d.id);
    await notify(c, d.proposed_by, 'Deal accepted', `"${d.title}" was accepted.`, { kind: 'deal', deal_id: d.id });
  }) });
}));

router.post('/deals/:id/cancel', wrap(async (req, res) => {
  res.json({ deal: await dealAction(req, async (c, d) => {
    await trans(c, d, 'cancelled', req.user.id, str(req.body.reason, 200) || 'Cancelled');
    await sysMessage(c, d.chat_id, `${req.user.display_name} cancelled the deal "${d.title}".`, d.id);
  }) });
}));

router.post('/deals/:id/sign', wrap(async (req, res) => {
  res.json({ deal: await dealAction(req, async (c, d) => {
    const col = d.buyer_id === req.user.id ? 'buyer_signed_at' : 'seller_signed_at';
    const r = await c.one(`update e_contracts set ${col} = coalesce(${col}, now()) where deal_id = $1 returning id`, [d.id]);
    need(r, 'The agreement is made when the deal is accepted.');
  }) });
}));

router.post('/deals/:id/pay', wrap(async (req, res) => {
  let payUrl = null;
  const deal = await dealAction(req, async (c, d) => {
    if (d.buyer_id !== req.user.id) throw new HttpError(403, 'Only the buyer pays.');
    if (d.status === 'accepted') await trans(c, d, 'payment_pending', req.user.id, 'Buyer started payment');
    else if (d.status !== 'payment_pending') throw new HttpError(409, `The deal is ${d.status}.`);
    const p = await initiatePayment(c, d);
    payUrl = p.pay_url;
  });
  res.json({ deal, pay_url: payUrl });
}));

router.post('/deals/:id/proof', wrap(async (req, res) => {
  const b = req.body;
  res.json({ deal: await dealAction(req, async (c, d) => {
    const stage = ['handover', 'dropoff', 'delivery', 'condition'].includes(b.stage) ? b.stage : 'handover';
    if (!['funded', 'handover_pending', 'shipped'].includes(d.status)) throw new HttpError(409, 'Proofs are saved after payment and before confirmation.');
    if (stage === 'dropoff' && d.seller_id !== req.user.id) throw bad('Only the seller saves a drop-off proof.');
    const selfie = await ownFile(b.selfie, req.user.id, 'deal-proofs');
    need(selfie, 'Take a selfie first.');
    const items = Array.isArray(b.item_photos) ? b.item_photos.slice(0, 4) : [];
    for (const it of items) await ownFile(it, req.user.id, 'deal-proofs');
    const lat = Number(b.lat), lng = Number(b.lng);
    need(Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180, 'Turn on location to save the proof.');
    const source = selfie.source === 'gallery' ? 'gallery' : selfie.source;
    if (source === 'gallery') throw bad('Use the camera, not a saved photo.');
    await c.query(
      `insert into deal_proofs(deal_id, user_id, stage, selfie_path, item_photo_paths, lat, lng, accuracy_m, is_mock_location, source) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [d.id, req.user.id, stage, selfie.id, items, lat, lng, Number(b.accuracy) || null, !!b.is_mock, source],
    );
    if (b.is_mock) await alert(c, { kind: 'mock_location', priority: 2, subject_type: 'deal', subject_id: d.id, title: 'Fake GPS used on a deal proof', body: `${req.user.display_name} saved a proof from a mock location app.` });
  }) });
}));

router.post('/deals/:id/ship', wrap(async (req, res) => {
  res.json({ deal: await dealAction(req, async (c, d) => {
    const tn = str(req.body.tracking_number, 40);
    need(tn.length >= 4, 'Add the tracking number.');
    await c.query('update deals set courier = $2, tracking_number = $3, tracking_status = $4 where id = $1', [d.id, str(req.body.courier, 40) || 'Sandbox courier', tn, 'picked_up']);
    await trans(c, d, 'shipped', req.user.id, `Shipped with ${str(req.body.courier, 40) || 'courier'} (${tn})`);
    await sysMessage(c, d.chat_id, `Shipped. Tracking number ${tn}.`, d.id);
    await notify(c, d.buyer_id, 'Your item is on the way', `Tracking number ${tn}.`, { kind: 'deal', deal_id: d.id });
  }) });
}));

router.post('/deals/:id/confirm', wrap(async (req, res) => {
  res.json({ deal: await dealAction(req, async (c, d) => {
    if (d.buyer_id !== req.user.id) throw new HttpError(403, 'Only the buyer confirms. The seller enters the buyer\'s release code instead.');
    await trans(c, d, 'buyer_confirmed', req.user.id, 'Buyer confirmed they got it');
    await afterConfirmed(c, d.id);
  }) });
}));

router.post('/deals/:id/release-code', wrap(async (req, res) => {
  const d0 = await dealIsParty(req.params.id, req.user.id);
  if (d0.seller_id !== req.user.id) throw new HttpError(403, 'The seller enters the buyer\'s code.');
  if (d0.release_code_locked) throw new HttpError(423, 'Too many wrong codes. The deal is locked for an admin to check.', 'locked');
  const s = await allSettings();
  const code = str(req.body.code, 8);
  const okCode = d0.release_code_hash && releaseCodeHash(code, d0.release_code_salt) === d0.release_code_hash;
  if (!okCode) {
    const r = await tx(async (c) => {
      const r = await c.one('update deals set release_code_attempts = release_code_attempts + 1, release_code_locked = (release_code_attempts + 1 >= $2) where id = $1 returning release_code_attempts, release_code_locked', [d0.id, Number(s.release_code_max_attempts)]);
      if (r.release_code_locked) {
        await alert(c, { kind: 'release_code_lockout', priority: 1, subject_type: 'deal', subject_id: d0.id, title: 'Release code locked after wrong tries', body: `Deal "${d0.title}": ${r.release_code_attempts} wrong codes.` });
        await notify(c, d0.buyer_id, 'Someone tried wrong release codes', `On "${d0.title}". The deal is locked until our team checks it. Never share your code before you check the item.`, { kind: 'deal', deal_id: d0.id });
      }
      return r;
    });
    throw new HttpError(r.release_code_locked ? 423 : 400, r.release_code_locked ? 'Too many wrong codes. The deal is locked for an admin to check.' : `Wrong code. ${Number(s.release_code_max_attempts) - r.release_code_attempts} tries left.`, r.release_code_locked ? 'locked' : 'wrong_code');
  }
  res.json({ deal: await dealAction(req, async (c, d) => {
    await trans(c, d, 'buyer_confirmed', req.user.id, 'Seller entered the buyer\'s release code');
    await afterConfirmed(c, d.id);
  }) });
}));

router.post('/deals/:id/dispute', wrap(async (req, res) => {
  const reason = str(req.body.reason, 200);
  need(reason.length >= 3, 'Pick or type a reason.');
  res.json({ deal: await dealAction(req, async (c, d) => {
    // cancel a pending release first so it can't be approved during the dispute
    await trans(c, d, 'disputed', req.user.id, `Dispute: ${reason}`);
    const pend = await c.many(`select id from admin_actions where subject_id = $1 and type = 'release_escrow' and status = 'pending'`, [d.id]);
    for (const p of pend) await c.query(`update admin_actions set status = 'rejected', decided_at = now(), decision_note = 'Auto-closed: a dispute was opened' where id = $1`, [p.id]);
    const disp = await c.one('insert into disputes(deal_id, opened_by, reason, details) values ($1,$2,$3,$4) returning *', [d.id, req.user.id, reason, str(req.body.details, 2000) || null]);
    const other = d.buyer_id === req.user.id ? d.seller_id : d.buyer_id;
    const s = await allSettings();
    await notify(c, other, 'A dispute was opened', `On "${d.title}": ${reason}. Add your side within ${s.dispute_evidence_hours} hours.`, { kind: 'deal', deal_id: d.id });
    await sysMessage(c, d.chat_id, `A dispute was opened: ${reason}. The money stays held until an admin decides.`, d.id);
    await alert(c, { kind: 'dispute', priority: 2, subject_type: 'deal', subject_id: d.id, title: 'New dispute', body: `${d.title} (${tk(d.amount_paisa)}): ${reason}`, data: { dispute_id: disp.id } });
  }) });
}));

router.post('/deals/:id/evidence', wrap(async (req, res) => {
  res.json({ deal: await dealAction(req, async (c, d) => {
    const disp = await c.one('select * from disputes where deal_id = $1', [d.id]);
    need(disp && disp.status !== 'resolved', 'There is no open dispute on this deal.');
    const media = Array.isArray(req.body.media) ? req.body.media.slice(0, 6) : [];
    for (const m of media) await ownFile(m, req.user.id);
    const note = str(req.body.note, 2000);
    need(note || media.length, 'Add a note or a photo.');
    await c.query('insert into dispute_evidence(dispute_id, user_id, note, media_paths) values ($1,$2,$3,$4)', [disp.id, req.user.id, note || null, media]);
  }) });
}));

router.post('/deals/:id/review', wrap(async (req, res) => {
  const d = await dealIsParty(req.params.id, req.user.id);
  need(['completed', 'refunded', 'split_done'].includes(d.status), 'You can review after the deal is finished.');
  const stars = Math.round(Number(req.body.stars));
  need(stars >= 1 && stars <= 5, 'Pick 1 to 5 stars.');
  const other = d.buyer_id === req.user.id ? d.seller_id : d.buyer_id;
  await tx(async (c) => {
    await c.query('insert into reviews(deal_id, reviewer_id, reviewee_id, stars, comment) values ($1,$2,$3,$4,$5) on conflict (deal_id, reviewer_id) do nothing', [d.id, req.user.id, other, stars, str(req.body.comment, 500) || null]);
    await computeTrust(c, other);
  });
  res.json({ deal: await dealView(await one('select * from deals where id = $1', [d.id]), req.user.id) });
}));

// ---------------- safety: SOS, trip share, safe spots ----------------
router.post('/deals/:id/sos', wrap(async (req, res) => {
  const d = await dealIsParty(req.params.id, req.user.id);
  const out = await tx(async (c) => {
    const s = await c.one('insert into sos_alerts(user_id, deal_id, lat, lng, accuracy_m) values ($1,$2,$3,$4,$5) returning *', [req.user.id, d.id, Number(req.body.lat) || null, Number(req.body.lng) || null, Number(req.body.accuracy) || null]);
    await alert(c, { kind: 'sos', priority: 0, subject_type: 'deal', subject_id: d.id, title: `SOS from ${req.user.display_name}`, body: `During "${d.title}". Phone: ${req.user.phone || 'not set'}.`, data: { sos_id: s.id, lat: s.lat, lng: s.lng } });
    await audit(c, req.user.id, 'user', 'sos', 'deal', d.id, { lat: s.lat, lng: s.lng }, ipOf(req));
    return s;
  });
  res.json({ ok: true, sos_id: out.id, message: 'Our team has been alerted with your location. If you are in danger, call 999 now.' });
}));

router.post('/deals/:id/trip-share', wrap(async (req, res) => {
  const d = await dealIsParty(req.params.id, req.user.id);
  const s = await allSettings();
  const token = crypto.randomBytes(12).toString('base64url');
  const t = await one(`insert into trip_shares(deal_id, user_id, share_token, expires_at, lat, lng, updated_at) values ($1,$2,$3, now() + make_interval(hours => $4), $5, $6, case when $5::float is not null then now() end) returning *`, [d.id, req.user.id, token, Number(s.trip_share_link_hours), Number(req.body.lat) || null, Number(req.body.lng) || null]);
  res.json({ url: `/trip/${t.share_token}`, expires_at: t.expires_at });
}));
router.post('/trip/:token/location', wrap(async (req, res) => {
  const r = await one('update trip_shares set lat = $3, lng = $4, updated_at = now() where share_token = $1 and user_id = $2 and expires_at > now() returning id', [req.params.token, req.user.id, Number(req.body.lat), Number(req.body.lng)]);
  if (!r) throw new HttpError(404, 'This trip link has ended.');
  res.json({ ok: true });
}));
router.get('/safe-spots', wrap(async (_req, res) => {
  res.json({ spots: await many('select id, name, area, note, lat, lng from safe_spots where active order by area, name') });
}));

// ---------------- wallet, notifications ----------------
router.get('/wallet', wrap(async (req, res) => {
  const id = req.user.id;
  const [held, owed, paid, payouts] = await Promise.all([
    one(`select coalesce(sum(amount_paisa),0)::bigint v from deals where buyer_id = $1 and status in ('funded','handover_pending','shipped','buyer_confirmed','release_queued','disputed','refund_queued','split_queued')`, [id]),
    one(`select coalesce(sum(debit_paisa - credit_paisa),0)::bigint v from ledger_entries where account = 'seller_payable' and user_id = $1`, [id]),
    one(`select coalesce(sum(debit_paisa),0)::bigint v from ledger_entries where account = 'seller_external' and user_id = $1`, [id]),
    many(`select p.id, p.amount_paisa, p.status, p.created_at, d.title from payouts p left join deals d on d.id = p.deal_id where p.user_id = $1 order by p.created_at desc limit 30`, [id]),
  ]);
  res.json({ held_as_buyer_paisa: held.v, waiting_payout_paisa: owed.v, paid_out_paisa: paid.v, payouts });
}));

router.get('/notifications', wrap(async (req, res) => {
  res.json({ notifications: await many('select * from notifications where user_id = $1 order by created_at desc limit 60', [req.user.id]) });
}));
router.post('/notifications/read', wrap(async (req, res) => {
  await q('update notifications set read_at = now() where user_id = $1 and read_at is null', [req.user.id]);
  res.json({ ok: true });
}));

// ---------------- support ----------------
router.get('/support', wrap(async (req, res) => {
  const [messages, ticket] = await Promise.all([
    many('select id, role, body, created_at from support_messages where user_id = $1 order by created_at limit 200', [req.user.id]),
    one(`select * from support_tickets where user_id = $1 and status = 'open' order by created_at desc limit 1`, [req.user.id]),
  ]);
  res.json({ messages, ticket });
}));
router.post('/support', wrap(async (req, res) => {
  const body = str(req.body.body, 1500);
  need(body, 'Type a question.');
  const ticket = await one(`select * from support_tickets where user_id = $1 and status = 'open' order by created_at desc limit 1`, [req.user.id]);
  await q('insert into support_messages(user_id, ticket_id, role, body) values ($1,$2,$3,$4)', [req.user.id, ticket?.id || null, 'user', body]);
  if (ticket) return res.json({ ok: true, reply: null, note: 'Sent to our team.' });
  const hist = await many('select role, body from support_messages where user_id = $1 order by created_at desc limit 8', [req.user.id]);
  const deals = await many(`select title, status, amount_paisa from deals where buyer_id = $1 or seller_id = $1 order by created_at desc limit 5`, [req.user.id]);
  const reply = await supportAgent(body, {
    appName: config.appName,
    history: hist.reverse().slice(0, -1).map((h) => ({ role: h.role === 'user' ? 'user' : 'assistant', content: h.body })),
    deals: deals.map((d) => `${d.title} (${d.status}, ${tk(d.amount_paisa)})`).join('; ') || 'none',
  });
  await q('insert into support_messages(user_id, role, body) values ($1,$2,$3)', [req.user.id, 'ai', reply]);
  res.json({ ok: true, reply });
}));
router.post('/support/human', wrap(async (req, res) => {
  let t = await one(`select * from support_tickets where user_id = $1 and status = 'open' limit 1`, [req.user.id]);
  if (!t) {
    t = await one('insert into support_tickets(user_id, subject) values ($1,$2) returning *', [req.user.id, str(req.body.subject, 140) || 'Help request']);
    await q(`insert into support_messages(user_id, ticket_id, role, body) values ($1,$2,'ai',$3)`, [req.user.id, t.id, 'A person from our team will reply here. You will get a notification.']);
  }
  res.json({ ticket: t });
}));

// trust details for the profile screen
router.get('/me/trust', wrap(async (req, res) => {
  const [hist, risk] = await Promise.all([
    many('select score, reason, created_at from trust_history where user_id = $1 order by created_at desc limit 20', [req.user.id]),
    tx((c) => riskForUser(c, req.user.id)),
  ]);
  res.json({ score: req.user.trust_score, history: hist, tips: risk.reasons });
}));
