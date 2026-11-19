// Test harness: a fresh database per test file and the real app on a random port.
import pg from 'pg';

const BASE = process.env.TEST_PG || 'postgres://postgres@localhost:5544/postgres?host=/tmp';
export const dbName = `p2pt_test_${process.pid}_${Math.floor(Math.random() * 1e6)}`;

export async function setup() {
  const admin = new pg.Client({ connectionString: BASE });
  await admin.connect();
  await admin.query(`create database ${dbName}`);
  await admin.end();
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = BASE.replace('/postgres?', `/${dbName}?`);
  process.env.ADMIN_EMAILS = 'boss@test.local';
  process.env.JOBS = '0';
  process.env.LLM_DISABLED = '1';
  const { migrate, pool } = await import('../src/db.js');
  await migrate();
  const { createApp } = await import('../src/app.js');
  const server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  return {
    url, pool,
    async close() {
      server.close();
      await pool.end();
      const a = new pg.Client({ connectionString: BASE });
      await a.connect();
      await a.query(`drop database if exists ${dbName} with (force)`);
      await a.end();
    },
  };
}

export function client(url) {
  let token = null;
  const call = async (method, path, body, extraHeaders = {}) => {
    const res = await fetch(url + path, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...extraHeaders },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
    return { status: res.status, ...json };
  };
  return {
    get token() { return token; }, set token(t) { token = t; },
    get: (p) => call('GET', p), post: (p, b = {}, h) => call('POST', p, b, h), put: (p, b) => call('PUT', p, b), patch: (p, b) => call('PATCH', p, b), del: (p) => call('DELETE', p),
  };
}

const IMG = Buffer.alloc(400, 7).toString('base64');
export async function upload(c, bucket, source = 'camera') {
  const r = await c.post('/api/files', { bucket, mime: 'image/jpeg', data: IMG, source });
  if (!r.id) throw new Error(`upload failed ${JSON.stringify(r)}`);
  return r.id;
}

let seq = 0;
export async function newUser(url, { name, phone, verify = false, admin = null, nid } = {}) {
  const c = client(url);
  seq++;
  const email = `u${seq}_${Math.floor(Math.random() * 1e6)}@test.local`;
  const r = await c.post('/api/auth/register', { email, password: 'password123', name: name || `User ${seq}`, device: `dev-${email}` });
  if (!r.token) throw new Error(`register failed ${JSON.stringify(r)}`);
  c.token = r.token;
  c.id = r.user.id;
  c.email = email;
  c.name = name || `User ${seq}`;
  if (phone !== false) {
    const ph = phone || `017${String(10000000 + Math.floor(Math.random() * 89999999)).slice(0, 8)}`;
    const p = await c.post('/api/me/phone', { phone: ph });
    if (!p.user) throw new Error(`phone failed ${JSON.stringify(p)}`);
  }
  if (verify) {
    await submitKyc(c, { nid });
    await approveAll(admin, 'approve_kyc');
  }
  return c;
}

export async function submitKyc(c, { nid } = {}) {
  const [front, back, selfie, turn] = await Promise.all([upload(c, 'kyc-private', 'camera'), upload(c, 'kyc-private', 'camera'), upload(c, 'kyc-private', 'camera'), upload(c, 'kyc-private', 'camera')]);
  const r = await c.post('/api/kyc', {
    nid_number: nid || String(1000000000 + Math.floor(Math.random() * 8999999999)), full_name_en: c.name, date_of_birth: '1995-04-02',
    nid_front: front, nid_back: back, selfie, selfie_turn: turn, liveness: { straight: true, turned: true },
  });
  return r;
}

export async function adminClient(url, pool) {
  const { totpAt } = await import('../src/auth.js');
  const c = client(url);
  let r = await c.post('/api/auth/register', { email: 'boss@test.local', password: 'password123', name: 'Boss' });
  if (!r.token) r = await c.post('/api/auth/login', { email: 'boss@test.local', password: 'password123' });
  const l = await c.post('/api/admin/auth/login', { email: 'boss@test.local', password: 'password123' });
  const secret = l.secret || (await pool.query(`select totp_secret from admin_users a join profiles p on p.id = a.user_id where p.email = 'boss@test.local'`)).rows[0].totp_secret;
  const v = await c.post('/api/admin/auth/2fa', { pre_token: l.pre_token, code: totpAt(secret) });
  if (!v.token) throw new Error(`admin 2fa failed ${JSON.stringify(v)}`);
  c.token = v.token;
  c.id = v.admin.id;
  return c;
}

export async function approveAll(admin, type) {
  const r = await admin.get(`/api/admin/actions?status=pending&type=${type}`);
  const out = [];
  for (const a of r.actions) out.push(await admin.post(`/api/admin/actions/${a.id}/decide`, { decision: 'approve' }));
  return out;
}

export async function makeListing(seller, price = 1500) {
  const photo = await upload(seller, 'listing-photos', 'gallery');
  const r = await seller.post('/api/listings', { title: 'Walton Primo phone', description: 'Good condition, 2 years old, with box and charger.', category: 'Phones & tablets', price, photos: [photo], condition: 'Used - good', location_area: 'Mirpur' });
  if (!r.listing) throw new Error(`listing failed ${JSON.stringify(r)}`);
  return r.listing;
}

// buyer opens chat on listing, proposes deal, seller accepts, buyer pays (sandbox).
export async function fundedDeal(url, buyer, seller, { amount = 1500, handover = 'meetup' } = {}) {
  const listing = await makeListing(seller, amount);
  const ch = await buyer.post('/api/chats', { listing_id: listing.id });
  const d = await buyer.post('/api/deals', { chat_id: ch.chat_id, role: 'buyer', amount, handover, terms: 'As described' });
  if (!d.deal) throw new Error(`deal failed ${JSON.stringify(d)}`);
  const acc = await seller.post(`/api/deals/${d.deal.id}/accept`);
  if (!acc.deal) throw new Error(`accept failed ${JSON.stringify(acc)}`);
  const pay = await buyer.post(`/api/deals/${d.deal.id}/pay`);
  const paymentId = pay.pay_url.split('/').pop();
  const done = await fetch(`${url}/pay/${paymentId}/complete`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'succeeded' }) });
  if (!done.ok) throw new Error('pay failed');
  return { dealId: d.deal.id, chatId: ch.chat_id, paymentId, listing };
}

export async function proof(c, dealId, { lat = 23.7509, lng = 90.3905, stage = 'handover', mock = false } = {}) {
  const selfie = await upload(c, 'deal-proofs', 'camera');
  return c.post(`/api/deals/${dealId}/proof`, { stage, selfie, lat, lng, accuracy: 8, is_mock: mock });
}
