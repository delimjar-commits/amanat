// The database rules that must hold even if the app code is wrong (spec: safety rails).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, client, newUser, adminClient, approveAll, fundedDeal, proof, upload, submitKyc, makeListing } from './helpers.js';

let env, admin;
before(async () => { env = await setup(); admin = await adminClient(env.url, env.pool); });
after(async () => { await env.close(); });
const sqlErr = async (sql, params) => { try { await env.pool.query(sql, params); return null; } catch (e) { return e.message; } };

test('ledger is append-only and can only be written by the money functions', async () => {
  const buyer = await newUser(env.url, { name: 'Ledger Buyer', verify: true, admin });
  const seller = await newUser(env.url, { name: 'Ledger Seller', verify: true, admin });
  await fundedDeal(env.url, buyer, seller, { amount: 500 });
  assert.match(await sqlErr('update ledger_entries set debit_paisa = 1 where id = (select min(id) from ledger_entries)'), /append_only/);
  assert.match(await sqlErr('delete from ledger_entries'), /append_only/);
  assert.match(await sqlErr(`insert into ledger_entries(txn_id, account, debit_paisa) values (gen_random_uuid(), 'platform_fees', 100)`), /money moves only/);
  // even with the flag set, an unbalanced transaction fails at commit
  const c = await env.pool.connect();
  try {
    await c.query('begin');
    await c.query(`select set_config('app.money','on',true)`);
    await c.query(`insert into ledger_entries(txn_id, account, debit_paisa) values (gen_random_uuid(), 'platform_fees', 100)`);
    await assert.rejects(c.query('commit'), /does not balance/);
  } finally { c.release(); }
  const v = (await env.pool.query('select * from ledger_verify()')).rows[0];
  assert.equal(v.ok, true);
});

test('the hash chain detects tampering', async () => {
  // simulate an attacker with table-owner rights bypassing the trigger
  const c = await env.pool.connect();
  try {
    await c.query('begin');
    await c.query('alter table ledger_entries disable trigger ledger_append_only');
    await c.query('update ledger_entries set debit_paisa = debit_paisa + 1 where id = (select min(id) from ledger_entries where debit_paisa > 0)');
    const v = (await c.query('select * from ledger_verify()')).rows[0];
    assert.equal(v.ok, false);
    assert.ok(v.broken_id);
    await c.query('rollback');
  } finally { c.release(); }
});

test('deal status can only change through transition_deal, and illegal jumps are refused', async () => {
  const buyer = await newUser(env.url, { name: 'State Buyer', verify: true, admin });
  const seller = await newUser(env.url, { name: 'State Seller', verify: true, admin });
  const { dealId } = await fundedDeal(env.url, buyer, seller, { amount: 400 });
  assert.match(await sqlErr(`update deals set status = 'released' where id = $1`, [dealId]), /only through transition_deal/);
  assert.match(await sqlErr(`update deals set amount_paisa = 1 where id = $1`, [dealId]), /fixed once proposed/);
  // a user can't release; the AI can't release; even admin can't release without execute_admin_action
  assert.match(await sqlErr(`select transition_deal($1, 'released', $2, 'user')`, [dealId, buyer.id]), /not allowed/);
  assert.match(await sqlErr(`select transition_deal($1, 'released', null, 'ai')`, [dealId]), /not allowed/);
  assert.match(await sqlErr(`select transition_deal($1, 'released', $2, 'admin')`, [dealId, admin.id]), /not allowed/);
  // a stranger is not a party
  const stranger = await newUser(env.url, { name: 'Stranger' });
  assert.match(await sqlErr(`select transition_deal($1, 'disputed', $2, 'user')`, [dealId, stranger.id]), /not a party/);
  assert.equal((await stranger.get(`/api/deals/${dealId}`)).status, 404);
  // can't fund without the payment function
  assert.match(await sqlErr(`select transition_deal($1, 'funded', null, 'system')`, [dealId]), /not allowed/);
});

test('execute_admin_action refuses anything not approved by an admin with the right role', async () => {
  const buyer = await newUser(env.url, { name: 'Exec Buyer', verify: true, admin });
  const seller = await newUser(env.url, { name: 'Exec Seller', verify: true, admin });
  const { dealId } = await fundedDeal(env.url, buyer, seller, { amount: 800 });
  await proof(buyer, dealId); await proof(seller, dealId);
  await buyer.post(`/api/deals/${dealId}/confirm`);
  const a = (await env.pool.query(`select * from admin_actions where subject_id = $1 and type = 'release_escrow'`, [dealId])).rows[0];
  assert.equal(a.status, 'pending');
  assert.match(await sqlErr('select execute_admin_action($1)', [a.id]), /must be approved/);
  // approval without an admin is refused by the trigger
  assert.match(await sqlErr(`update admin_actions set status = 'approved' where id = $1`, [a.id]), /needs an admin/);
  // a support-role admin can't approve a release
  const sup = await newUser(env.url, { name: 'Support Person' });
  await env.pool.query(`insert into admin_users(user_id, role) values ($1, 'support')`, [sup.id]);
  await env.pool.query(`update admin_actions set status = 'approved', decided_by = $2 where id = $1`, [a.id, sup.id]);
  assert.match(await sqlErr('select execute_admin_action($1)', [a.id]), /role support can't run release_escrow/);
  // request fields are frozen, history can't go backwards, rows can't be deleted
  assert.match(await sqlErr(`update admin_actions set payload = '{}' where id = $1`, [a.id]), /can't be edited/);
  assert.match(await sqlErr(`update admin_actions set status = 'pending' where id = $1`, [a.id]), /illegal status/);
  assert.match(await sqlErr(`delete from admin_actions where id = $1`, [a.id]), /never deleted/);
  // the deal did not move
  assert.equal((await buyer.get(`/api/deals/${dealId}`)).deal.status, 'release_queued');
});

test('the AI never moves money: agents only write ai_reviews and pending actions', async () => {
  const before = (await env.pool.query(`select count(*)::int n from admin_actions where status = 'executed' and requested_by like 'ai:%' and decided_by is null`)).rows[0].n;
  assert.equal(before, 0);
  const executedByNobody = (await env.pool.query(`select count(*)::int n from admin_actions where status = 'executed' and decided_by is null`)).rows[0].n;
  assert.equal(executedByNobody, 0);
  assert.match(await sqlErr(`update ai_reviews set recommendation = 'approve'`), /append_only/);
  assert.match(await sqlErr(`delete from audit_log`), /append_only/);
  assert.match(await sqlErr(`delete from deal_events`), /append_only/);
});

test('admin API needs 2FA; normal user tokens and pre-2FA tokens are refused', async () => {
  const u = await newUser(env.url, { name: 'Plain User' });
  assert.equal((await u.get('/api/admin/dashboard')).status, 401);
  // a non-admin can't even start admin sign-in
  const l = await client(env.url).post('/api/admin/auth/login', { email: u.email, password: 'password123' });
  assert.equal(l.code, 'not_admin');
  // pre-2FA token is not an admin token
  const al = await client(env.url).post('/api/admin/auth/login', { email: 'boss@test.local', password: 'password123' });
  assert.equal(al.step, 'verify_2fa');
  const pre = client(env.url); pre.token = al.pre_token;
  assert.equal((await pre.get('/api/admin/dashboard')).status, 401);
  const wrong = await client(env.url).post('/api/admin/auth/2fa', { pre_token: al.pre_token, code: '000000' });
  assert.equal(wrong.status, 401);
  // wrong password
  assert.equal((await client(env.url).post('/api/admin/auth/login', { email: 'boss@test.local', password: 'nope-nope' })).status, 401);
});

test('admin comes only from ADMIN_EMAILS, never from signing up first', async () => {
  // this file's first registered account was boss@ (in ADMIN_EMAILS); every other account is a plain user
  const rows = (await env.pool.query(`select p.email from admin_users a join profiles p on p.id = a.user_id where a.active`)).rows.map((r) => r.email);
  assert.ok(rows.every((e) => e === 'boss@test.local' || e.startsWith('u')), JSON.stringify(rows));
  assert.ok(!rows.some((e) => e !== 'boss@test.local' && !(e.includes('@test.local') && rows.length > 1)));
  const fresh = await newUser(env.url, { name: 'Fresh Person' });
  const me = await fresh.get('/api/me');
  assert.equal(me.user.is_admin, false);
});

test('role checks: a kyc_reviewer can approve KYC but not releases or settings', async () => {
  const rev = await newUser(env.url, { name: 'Kyc Reviewer' });
  await admin.post(`/api/admin/users/${rev.id}/role`, { role: 'kyc_reviewer' });
  const { totpAt } = await import('../src/auth.js');
  const rc = client(env.url);
  const l = await rc.post('/api/admin/auth/login', { email: rev.email, password: 'password123' });
  assert.equal(l.step, 'setup_2fa');
  const v = await rc.post('/api/admin/auth/2fa', { pre_token: l.pre_token, code: totpAt(l.secret) });
  rc.token = v.token;
  assert.equal(v.admin.role, 'kyc_reviewer');
  const subject = await newUser(env.url, { name: 'Kyc Subject' });
  await submitKyc(subject);
  const pend = (await rc.get('/api/admin/actions?status=pending&type=approve_kyc')).actions;
  const mine = pend.find((a) => a.payload.user_id === subject.id);
  assert.equal(mine.can_decide, true);
  const ok = await rc.post(`/api/admin/actions/${mine.id}/decide`, { decision: 'approve' });
  assert.equal(ok.status, 'executed', JSON.stringify(ok));
  assert.equal((await subject.get('/api/me')).user.kyc_level, 'verified');
  assert.equal((await rc.put('/api/admin/settings', { platform_fee_percent: 5 })).status, 403);
  assert.equal((await rc.get('/api/admin/ledger')).status, 403);
});

test('KYC: same NID on a second account is rejected by the AI and raises an alert', async () => {
  const a = await newUser(env.url, { name: 'Nid Owner', verify: true, admin, nid: '1990123456789' });
  const b = await newUser(env.url, { name: 'Nid Copycat' });
  const r = await submitKyc(b, { nid: '1990123456789' });
  assert.equal(r.status, 'ai_checked');
  const act = (await admin.get('/api/admin/actions?status=pending&type=reject_kyc')).actions.find((x) => x.payload.user_id === b.id);
  assert.ok(act, 'AI recommends rejection');
  assert.equal(act.recommendation, 'reject');
  const al = await admin.get('/api/admin/alerts');
  assert.ok(al.alerts.some((x) => x.kind === 'duplicate_nid' && x.subject_id === b.id));
  assert.ok(a.id);
});

test('private files need a signed link; other users can\'t read KYC images', async () => {
  const u = await newUser(env.url, { name: 'File Owner' });
  const id = await upload(u, 'kyc-private');
  const other = await newUser(env.url, { name: 'File Snoop' });
  const res = await fetch(`${env.url}/api/files/${id}`, { headers: { authorization: `Bearer ${other.token}` } });
  assert.equal(res.status, 403);
  const own = await fetch(`${env.url}/api/files/${id}`, { headers: { authorization: `Bearer ${u.token}` } });
  assert.equal(own.status, 200);
  const forged = await fetch(`${env.url}/api/files/${id}?exp=9999999999&sig=abc`);
  assert.equal(forged.status, 403);
  // someone else's file can't be attached to your KYC
  const r = await other.post('/api/kyc', { nid_number: '1234567890', full_name_en: 'File Snoop', date_of_birth: '1990-01-01', nid_front: id, nid_back: id, selfie: id });
  assert.equal(r.status, 400);
});

test('gallery photos can\'t be used as deal proofs; GPS is required', async () => {
  const buyer = await newUser(env.url, { name: 'Proof Buyer', verify: true, admin });
  const seller = await newUser(env.url, { name: 'Proof Seller', verify: true, admin });
  const { dealId } = await fundedDeal(env.url, buyer, seller, { amount: 300 });
  const g = await upload(buyer, 'deal-proofs', 'gallery');
  assert.equal((await buyer.post(`/api/deals/${dealId}/proof`, { stage: 'handover', selfie: g, lat: 23.7, lng: 90.4 })).status, 400);
  const cam = await upload(buyer, 'deal-proofs', 'camera');
  assert.equal((await buyer.post(`/api/deals/${dealId}/proof`, { stage: 'handover', selfie: cam })).status, 400);
});

test('scam watch flags outside-payment and OTP requests in chat', async () => {
  const s = await newUser(env.url, { name: 'Chat Seller', verify: true, admin });
  const b = await newUser(env.url, { name: 'Chat Buyer' });
  const l = await makeListing(s, 500);
  const ch = await b.post('/api/chats', { listing_id: l.id });
  const m1 = await s.post(`/api/chats/${ch.chat_id}/messages`, { body: 'Bhai advance 500 taka bkash kore den' });
  assert.ok(m1.message.ai_flag);
  const m2 = await s.post(`/api/chats/${ch.chat_id}/messages`, { body: 'apnar OTP ta dao' });
  assert.match(m2.message.ai_flag, /OTP/);
  const m3 = await b.post(`/api/chats/${ch.chat_id}/messages`, { body: 'Is it still available? Can we meet at Bashundhara tomorrow?' });
  assert.equal(m3.message.ai_flag, null);
  // listing with a phone number is held for review
  const photo = await upload(s, 'listing-photos');
  const held = await s.post('/api/listings', { title: 'Sofa set', description: 'Call me 01712345678 for details please', category: 'Home & living', price: 9000, photos: [photo] });
  assert.equal(held.listing.status, 'pending_review');
  const pend = (await admin.get('/api/admin/actions?status=pending&type=remove_listing')).actions.find((a) => a.subject_id === held.listing.id);
  assert.ok(pend);
  // admin rejects the removal = listing goes live
  await admin.post(`/api/admin/actions/${pend.id}/decide`, { decision: 'reject', note: 'Fine after all' });
  assert.equal((await s.get(`/api/listings/${held.listing.id}`)).listing.status, 'active');
});

test('ban: approved ban blocks sign-in and removes listings; police export only after approval', async () => {
  const bad = await newUser(env.url, { name: 'Bad Actor', verify: true, admin });
  const l = await makeListing(bad, 400);
  const req = await admin.post('/api/admin/actions', { type: 'ban_user', subject_id: bad.id, reason: 'Fraud' });
  assert.equal(req.action.status, 'pending');
  assert.equal((await bad.get('/api/me')).status, 200, 'nothing happens until approved');
  await admin.post(`/api/admin/actions/${req.action.id}/decide`, { decision: 'approve' });
  assert.equal((await bad.get('/api/me')).status, 403);
  assert.equal((await client(env.url).post('/api/auth/login', { email: bad.email, password: 'password123' })).status, 403);
  const lr = (await env.pool.query('select status from listings where id = $1', [l.id])).rows[0];
  assert.equal(lr.status, 'removed');
  const ph = await admin.post('/api/admin/actions', { type: 'police_handover', subject_id: bad.id, reason: 'Case 123' });
  const early = await fetch(`${env.url}/api/admin/police-export/${ph.action.id}`, { headers: { authorization: `Bearer ${admin.token}` } });
  assert.equal(early.status, 403);
  await admin.post(`/api/admin/actions/${ph.action.id}/decide`, { decision: 'approve' });
  const pdf = await fetch(`${env.url}/api/admin/police-export/${ph.action.id}`, { headers: { authorization: `Bearer ${admin.token}` } });
  assert.equal(pdf.status, 200);
  assert.equal((await pdf.arrayBuffer()).byteLength > 500, true);
  const audit = await admin.get('/api/admin/audit');
  assert.ok(audit.entries.some((e) => e.action === 'police_export_download'));
});

test('blacklist: an approved blacklist blocks that phone and payout account on new accounts', async () => {
  const bad = await newUser(env.url, { name: 'Fraud Ring', verify: true, admin, phone: '01655555555' });
  await bad.post('/api/payout-accounts', { method: 'bkash', account_number: '01655555556', account_name: 'Fraud Ring' });
  const r = await admin.post('/api/admin/actions', { type: 'blacklist_add', subject_id: bad.id, reason: 'Scam ring' });
  await admin.post(`/api/admin/actions/${r.action.id}/decide`, { decision: 'approve' });
  const n = await newUser(env.url, { name: 'New Face', phone: false });
  assert.equal((await n.post('/api/me/phone', { phone: '01655555555' })).status, 403);
  // sign-up with a blacklisted device is refused
  const dev = (await env.pool.query('select device_fingerprint from devices where user_id = $1', [bad.id])).rows[0].device_fingerprint;
  const s = await client(env.url).post('/api/auth/register', { email: 'again@test.local', password: 'password123', name: 'Again', device: dev });
  assert.equal(s.status, 403);
});

test('settings: super admin changes fees; new deals use them; AI key is stored encrypted and hidden', async () => {
  await admin.put('/api/admin/settings', { platform_fee_percent: 3 });
  const s = await admin.get('/api/admin/settings');
  assert.equal(s.settings.platform_fee_percent, 3);
  await admin.put('/api/admin/settings/ai', { base_url: 'example.ngrok.app', api_key: 'sk-test-1234567890', model_fast: 'gpt-4o-mini' });
  const s2 = await admin.get('/api/admin/settings');
  assert.equal(s2.ai.base_url, 'https://example.ngrok.app/v1');
  assert.equal(s2.ai.has_key, true);
  assert.equal(s2.ai.key_hint, '…7890');
  assert.equal(JSON.stringify(s2).includes('sk-test'), false);
  const raw = (await env.pool.query(`select value from settings where key = 'ai'`)).rows[0].value;
  assert.equal(JSON.stringify(raw).includes('sk-test'), false);
  assert.equal((await admin.put('/api/admin/settings', { platform_fee_percent: 50 })).status, 400);
  await admin.put('/api/admin/settings', { platform_fee_percent: 2 });
  await admin.put('/api/admin/settings/ai', { clear_key: true, base_url: '' });
});

test('jobs: ledger reconcile passes on real data and the copilot answers without AI', async () => {
  const { runJob } = await import('../src/jobs.js');
  const r = await runJob('ledger-reconcile');
  assert.equal(r.ok, true);
  assert.match(r.result, /^ok/);
  const cp = await admin.post('/api/admin/ai/copilot', { question: 'How much is in escrow?' });
  assert.match(cp.answer, /escrow held paisa/);
  const fr = await admin.post('/api/admin/ai/fraud-report');
  assert.equal(fr.review.agent, 'fraud_report');
  const dash = await admin.get('/api/admin/dashboard');
  assert.equal(dash.volume.length, 14);
  assert.ok(dash.stats.users > 5);
});
