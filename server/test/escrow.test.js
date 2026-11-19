import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, client, newUser, adminClient, approveAll, fundedDeal, proof, upload, submitKyc } from './helpers.js';

let env, admin;
before(async () => { env = await setup(); admin = await adminClient(env.url, env.pool); });
after(async () => { await env.close(); });

const ledgerOk = async () => (await env.pool.query('select * from ledger_verify()')).rows[0];
const balance = async (acct, dealId) => Number((await env.pool.query(`select coalesce(sum(debit_paisa - credit_paisa),0) b from ledger_entries where account = $1 ${dealId ? 'and deal_id = $2' : ''}`, dealId ? [acct, dealId] : [acct])).rows[0].b);

test('meetup deal: pay, both proofs, release code, admin release, payout, complete', async () => {
  const buyer = await newUser(env.url, { name: 'Rahim Uddin', verify: true, admin });
  const seller = await newUser(env.url, { name: 'Karim Hossain', verify: true, admin });
  const acct = await seller.post('/api/payout-accounts', { method: 'bkash', account_number: '01711111111', account_name: 'Karim Hossain' });
  assert.equal(acct.account.name_matches_kyc, true);

  const { dealId } = await fundedDeal(env.url, buyer, seller, { amount: 2000 });
  let d = (await buyer.get(`/api/deals/${dealId}`)).deal;
  assert.equal(d.status, 'handover_pending');
  assert.match(d.release_code, /^\d{4}$/);
  assert.equal(await balance('escrow_hold', dealId), 200000);
  // the seller never sees the code
  assert.equal((await seller.get(`/api/deals/${dealId}`)).deal.release_code, null);

  // code alone is not enough: both proofs first
  const early = await seller.post(`/api/deals/${dealId}/release-code`, { code: d.release_code });
  assert.equal(early.status, 409);
  assert.equal((await proof(buyer, dealId)).deal.proofs.length, 1);
  await proof(seller, dealId, { lat: 23.7511, lng: 90.3907 });
  const conf = await seller.post(`/api/deals/${dealId}/release-code`, { code: d.release_code });
  assert.equal(conf.deal.status, 'release_queued', JSON.stringify(conf));

  // no money moved yet: still in escrow
  assert.equal(await balance('escrow_hold', dealId), 200000);
  const q = await admin.get('/api/admin/actions?status=pending&type=release_escrow');
  const rel = q.actions.find((a) => a.subject_id === dealId);
  assert.ok(rel, 'release waits in the queue');
  assert.equal(rel.recommendation, 'release');
  const detail = await admin.get(`/api/admin/actions/${rel.id}`);
  assert.equal(detail.subject.proofs.length, 2);

  const ex = await admin.post(`/api/admin/actions/${rel.id}/decide`, { decision: 'approve' });
  assert.equal(ex.status, 'executed', JSON.stringify(ex));
  d = (await seller.get(`/api/deals/${dealId}`)).deal;
  assert.equal(d.status, 'released');
  assert.equal(await balance('escrow_hold', dealId), 0);
  assert.equal(await balance('platform_fees', dealId), 4000); // 2%
  assert.equal(await balance('guarantee_fund', dealId), 1000); // 0.5%
  assert.equal(await balance('seller_payable', dealId), 195000);

  // payout queued automatically, finance approves
  const [po] = await approveAll(admin, 'approve_payout');
  assert.equal(po.status, 'executed', JSON.stringify(po));
  d = (await seller.get(`/api/deals/${dealId}`)).deal;
  assert.equal(d.status, 'completed');
  assert.equal(await balance('seller_payable', dealId), 0);
  assert.equal(await balance('seller_external', dealId), 195000);
  const w = await seller.get('/api/wallet');
  assert.equal(w.paid_out_paisa >= 195000, true);

  // reviews open after completion and update trust
  const rv = await buyer.post(`/api/deals/${dealId}/review`, { stars: 5, comment: 'Smooth' });
  assert.equal(rv.deal.my_review.stars, 5);
  const prof = await buyer.get(`/api/users/${seller.id}`);
  assert.equal(prof.rating.n, 1);
  assert.ok(prof.user.trust_score > 50);

  const v = await ledgerOk();
  assert.equal(v.ok, true);
});

test('buyer can confirm in the app instead of a code; dispute after confirm cancels the pending release', async () => {
  const buyer = await newUser(env.url, { name: 'Nusrat Jahan', verify: true, admin });
  const seller = await newUser(env.url, { name: 'Tanvir Ahmed', verify: true, admin });
  const { dealId } = await fundedDeal(env.url, buyer, seller, { amount: 1000 });
  await proof(buyer, dealId); await proof(seller, dealId);
  const c = await buyer.post(`/api/deals/${dealId}/confirm`);
  assert.equal(c.deal.status, 'release_queued');
  // seller cannot use the buyer-only confirm
  const dsp = await buyer.post(`/api/deals/${dealId}/dispute`, { reason: 'Screen has a crack not shown' });
  assert.equal(dsp.deal.status, 'disputed', JSON.stringify(dsp));
  const pend = await admin.get('/api/admin/actions?status=pending&type=release_escrow');
  assert.equal(pend.actions.some((a) => a.subject_id === dealId), false, 'pending release was auto-closed');
  const closed = await admin.get('/api/admin/actions?status=rejected&type=release_escrow');
  assert.ok(closed.actions.some((a) => a.subject_id === dealId && /dispute/.test(a.decision_note)));
});

test('release code: wrong codes lock the deal after 5 tries and alert admins', async () => {
  const buyer = await newUser(env.url, { name: 'Sadia Islam', verify: true, admin });
  const seller = await newUser(env.url, { name: 'Imran Kabir', verify: true, admin });
  const { dealId } = await fundedDeal(env.url, buyer, seller, { amount: 1000 });
  await proof(buyer, dealId); await proof(seller, dealId);
  const real = (await buyer.get(`/api/deals/${dealId}`)).deal.release_code;
  const wrong = real === '0000' ? '1111' : '0000';
  for (let i = 0; i < 4; i++) assert.equal((await seller.post(`/api/deals/${dealId}/release-code`, { code: wrong })).code, 'wrong_code');
  const fifth = await seller.post(`/api/deals/${dealId}/release-code`, { code: wrong });
  assert.equal(fifth.status, 423);
  // even the right code is refused now
  assert.equal((await seller.post(`/api/deals/${dealId}/release-code`, { code: real })).status, 423);
  assert.equal((await buyer.get(`/api/deals/${dealId}`)).deal.release_code, null);
  const alerts = await admin.get('/api/admin/alerts');
  assert.ok(alerts.alerts.some((a) => a.kind === 'release_code_lockout' && a.subject_id === dealId));
});

test('dispute: AI analysis queues a refund, admin approves, buyer refunded, ledger balanced', async () => {
  const buyer = await newUser(env.url, { name: 'Farzana Akter', verify: true, admin });
  const seller = await newUser(env.url, { name: 'Shakil Mia', verify: true, admin });
  const { dealId } = await fundedDeal(env.url, buyer, seller, { amount: 2500 });
  // seller never shows up; buyer disputes
  const dsp = await buyer.post(`/api/deals/${dealId}/dispute`, { reason: 'Seller did not come', details: 'Waited 1 hour at the mall' });
  assert.equal(dsp.deal.status, 'disputed');
  const ev = await buyer.post(`/api/deals/${dealId}/evidence`, { note: 'Screenshot of chat', media: [await upload(buyer, 'evidence')] });
  assert.equal(ev.deal.dispute.evidence.length, 1);
  const list = await admin.get('/api/admin/disputes');
  const disp = list.disputes.find((x) => x.deal_id === dealId);
  const an = await admin.post(`/api/admin/disputes/${disp.id}/analyze`);
  assert.equal(an.review.recommendation, 'refund', JSON.stringify(an));
  const pend = await admin.get('/api/admin/actions?status=pending&type=refund_escrow');
  const act = pend.actions.find((a) => a.subject_id === dealId);
  assert.ok(act);
  const ex = await admin.post(`/api/admin/actions/${act.id}/decide`, { decision: 'approve' });
  assert.equal(ex.status, 'executed', JSON.stringify(ex));
  const d = (await buyer.get(`/api/deals/${dealId}`)).deal;
  assert.equal(d.status, 'refunded');
  assert.equal(d.dispute.status, 'resolved');
  assert.equal(await balance('escrow_hold', dealId), 0);
  assert.equal(await balance('platform_fees', dealId), 0, 'no fee on a refund');
  assert.equal((await ledgerOk()).ok, true);
});

test('dispute: admin changes the outcome to a split and edits the amounts before approving', async () => {
  const buyer = await newUser(env.url, { name: 'Mitu Rani', verify: true, admin });
  const seller = await newUser(env.url, { name: 'Babul Sarkar', verify: true, admin });
  await seller.post('/api/payout-accounts', { method: 'nagad', account_number: '01822222222', account_name: 'Babul Sarkar' });
  const { dealId } = await fundedDeal(env.url, buyer, seller, { amount: 2000 });
  await buyer.post(`/api/deals/${dealId}/dispute`, { reason: 'Item not as described' });
  const r = await admin.post(`/api/admin/deals/${dealId}/resolve`, { to: 'split', buyer_paisa: 100000 });
  assert.equal(r.action.type, 'split_escrow');
  const ex = await admin.post(`/api/admin/actions/${r.action.id}/decide`, { decision: 'approve', payload_edit: { buyer_paisa: 50000 } });
  assert.equal(ex.status, 'executed', JSON.stringify(ex));
  const orig = await admin.get(`/api/admin/actions/${r.action.id}`);
  assert.equal(orig.action.status, 'rejected', 'original kept as history');
  assert.equal(await balance('escrow_hold', dealId), 0);
  // buyer got 500 back; seller share is 1500 minus 2% and 0.5%
  assert.equal(await balance('buyer_external', dealId), -200000 + 50000);
  assert.equal(await balance('seller_payable', dealId) + (await balance('seller_external', dealId)), 150000 - 3000 - 750);
  assert.equal((await buyer.get(`/api/deals/${dealId}`)).deal.status, 'split_done');
  assert.equal((await ledgerOk()).ok, true);
});

test('courier deal: ship needs tracking + drop-off proof; delivered + 72h auto-queues release', async () => {
  const buyer = await newUser(env.url, { name: 'Ayesha Siddiqua', verify: true, admin });
  const seller = await newUser(env.url, { name: 'Jamal Uddin', verify: true, admin });
  const { dealId } = await fundedDeal(env.url, buyer, seller, { amount: 1200, handover: 'courier' });
  let d = (await buyer.get(`/api/deals/${dealId}`)).deal;
  assert.equal(d.status, 'funded');
  assert.equal(d.release_code, null, 'no release code for courier deals');
  const noProof = await seller.post(`/api/deals/${dealId}/ship`, { courier: 'Pathao', tracking_number: 'PTH12345' });
  assert.equal(noProof.status, 409);
  await proof(seller, dealId, { stage: 'dropoff' });
  const sh = await seller.post(`/api/deals/${dealId}/ship`, { courier: 'Pathao', tracking_number: 'PTH12346' });
  assert.equal(sh.deal.status, 'shipped', JSON.stringify(sh));
  // courier webhook, signed
  const { webhookSignature } = await import('../src/services.js');
  const body = JSON.stringify({ tracking_number: 'PTH12346', status: 'delivered', at: new Date(Date.now() - 73 * 3600e3).toISOString() });
  const bad = await fetch(`${env.url}/api/webhooks/courier`, { method: 'POST', headers: { 'x-signature': 'nope' }, body });
  assert.equal(bad.status, 401);
  const ok = await fetch(`${env.url}/api/webhooks/courier`, { method: 'POST', headers: { 'x-signature': webhookSignature(body, process.env.COURIER_WEBHOOK_SECRET || process.env.PAYMENT_WEBHOOK_SECRET || 'dev-only-courier-secret') }, body });
  assert.equal(ok.status, 200);
  const { runJob } = await import('../src/jobs.js');
  const r = await runJob('auto-release');
  assert.match(r.result, /1 deal/);
  d = (await buyer.get(`/api/deals/${dealId}`)).deal;
  assert.equal(d.status, 'release_queued');
  const pend = await admin.get('/api/admin/actions?status=pending&type=release_escrow');
  assert.ok(pend.actions.some((a) => a.subject_id === dealId));
});

test('payment webhook: bad signature refused, duplicate delivery ignored, amount mismatch refused', async () => {
  const buyer = await newUser(env.url, { name: 'Rumana Khatun', verify: true, admin });
  const seller = await newUser(env.url, { name: 'Hasan Ali', verify: true, admin });
  const { dealId, paymentId } = await fundedDeal(env.url, buyer, seller, { amount: 900 });
  const p = (await env.pool.query('select * from payments where id = $1', [paymentId])).rows[0];
  const { webhookSignature } = await import('../src/services.js');
  const body = JSON.stringify({ provider_ref: p.provider_ref, status: 'succeeded', amount_paisa: p.amount_paisa });
  const badSig = await fetch(`${env.url}/api/webhooks/payment`, { method: 'POST', headers: { 'x-signature': 'x' }, body });
  assert.equal(badSig.status, 401);
  const dup = await fetch(`${env.url}/api/webhooks/payment`, { method: 'POST', headers: { 'x-signature': webhookSignature(body) }, body });
  assert.equal((await dup.json()).duplicate, true);
  assert.equal(await balance('escrow_hold', dealId), 90000, 'funded exactly once');

  // mismatch on a fresh payment
  const { dealId: d2 } = await (async () => {
    const l = await (await import('./helpers.js')).makeListing(seller, 800);
    const ch = await buyer.post('/api/chats', { listing_id: l.id });
    const d = await buyer.post('/api/deals', { chat_id: ch.chat_id, role: 'buyer', amount: 800, handover: 'meetup' });
    await seller.post(`/api/deals/${d.deal.id}/accept`);
    return { dealId: d.deal.id };
  })();
  const pay = await buyer.post(`/api/deals/${d2}/pay`);
  const p2 = (await env.pool.query('select * from payments where id = $1', [pay.pay_url.split('/').pop()])).rows[0];
  const b2 = JSON.stringify({ provider_ref: p2.provider_ref, status: 'succeeded', amount_paisa: 1 });
  const mm = await fetch(`${env.url}/api/webhooks/payment`, { method: 'POST', headers: { 'x-signature': webhookSignature(b2) }, body: b2 });
  assert.equal(mm.status, 400);
  assert.equal((await buyer.get(`/api/deals/${d2}`)).deal.status, 'payment_pending');
});

test('limits: unverified users can\'t take part above their limit; new users capped', async () => {
  const buyer = await newUser(env.url, { name: 'Basic Buyer' }); // phone only = basic
  const seller = await newUser(env.url, { name: 'Ripon Das', verify: true, admin });
  const l = await (await import('./helpers.js')).makeListing(seller, 6000);
  const ch = await buyer.post('/api/chats', { listing_id: l.id });
  const tooBig = await buyer.post('/api/deals', { chat_id: ch.chat_id, role: 'buyer', amount: 6000, handover: 'meetup' });
  assert.equal(tooBig.status, 403);
  assert.equal(tooBig.code, 'limit');
  // verified seller still new (<5 deals): capped at 3000
  const b2 = await newUser(env.url, { name: 'Shila Roy', verify: true, admin });
  const ch2 = await b2.post('/api/chats', { listing_id: l.id });
  const cap = await b2.post('/api/deals', { chat_id: ch2.chat_id, role: 'buyer', amount: 3500, handover: 'meetup' });
  assert.equal(cap.code, 'limit');
  // no phone at all = can't chat
  const nobody = await newUser(env.url, { name: 'No Phone', phone: false });
  assert.equal((await nobody.post('/api/chats', { listing_id: l.id })).code, 'kyc_required');
});

test('payout is blocked when the account name does not match the NID name', async () => {
  const buyer = await newUser(env.url, { name: 'Mahmud Hasan', verify: true, admin });
  const seller = await newUser(env.url, { name: 'Sumaiya Noor', verify: true, admin });
  const acct = await seller.post('/api/payout-accounts', { method: 'bkash', account_number: '01933333333', account_name: 'Someone Else' });
  assert.equal(acct.account.name_matches_kyc, false);
  const { dealId } = await fundedDeal(env.url, buyer, seller, { amount: 700 });
  await proof(buyer, dealId); await proof(seller, dealId);
  await buyer.post(`/api/deals/${dealId}/confirm`);
  await approveAll(admin, 'release_escrow');
  const payouts = (await env.pool.query('select * from payouts where deal_id = $1', [dealId])).rows;
  assert.equal(payouts.length, 0, 'no payout queued to a mismatched name');
  const n = await seller.get('/api/notifications');
  assert.ok(n.notifications.some((x) => /payout account/i.test(x.title)));
  // add a matching one: payout queues now
  await seller.post('/api/payout-accounts', { method: 'bkash', account_number: '01944444444', account_name: 'Sumaiya Noor' });
  assert.equal((await env.pool.query('select * from payouts where deal_id = $1', [dealId])).rows.length, 1);
});

test('mock GPS and far-apart proofs are flagged for the admin, not auto-trusted', async () => {
  const buyer = await newUser(env.url, { name: 'Lima Begum', verify: true, admin });
  const seller = await newUser(env.url, { name: 'Sohel Rana', verify: true, admin });
  const { dealId } = await fundedDeal(env.url, buyer, seller, { amount: 600 });
  await proof(buyer, dealId, { lat: 23.75, lng: 90.39 });
  await proof(seller, dealId, { lat: 23.81, lng: 90.42, mock: true });
  await buyer.post(`/api/deals/${dealId}/confirm`);
  const a = (await admin.get('/api/admin/actions?status=pending&type=release_escrow')).actions.find((x) => x.subject_id === dealId);
  assert.equal(a.recommendation, 'flag');
  assert.equal(a.priority, 1);
  assert.equal(a.bulk_ok, false);
  const alerts = await admin.get('/api/admin/alerts');
  assert.ok(alerts.alerts.some((x) => x.kind === 'mock_location' && x.subject_id === dealId));
});
