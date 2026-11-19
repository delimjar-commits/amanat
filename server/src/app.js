import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { one, many, tx } from './db.js';
import { HttpError, requireUser } from './auth.js';
import { router as userRouter } from './routes/user.js';
import { router as adminRouter } from './routes/admin.js';
import { handlePaymentEvent, handleCourierEvent, webhookSignature, tk, dealIsParty } from './services.js';
import { llmConfig } from './llm.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const pub = path.join(here, '..', 'public');
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// tiny in-memory rate limiter per ip+route group
const buckets = new Map();
function limit(name, max, windowMs) {
  return (req, _res, next) => {
    if (process.env.NODE_ENV === 'test') return next();
    const key = `${name}:${(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0]}`;
    const now = Date.now();
    const b = buckets.get(key) || { n: 0, reset: now + windowMs };
    if (now > b.reset) { b.n = 0; b.reset = now + windowMs; }
    b.n++;
    buckets.set(key, b);
    if (b.n > max) return next(new HttpError(429, 'Too many tries. Wait a minute and try again.'));
    next();
  };
}

const page = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>${title}</title><link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet"><style>
*{box-sizing:border-box}body{margin:0;font-family:Inter,system-ui,sans-serif;background:#fafafa;color:#111827;-webkit-font-smoothing:antialiased}
.wrap{max-width:440px;margin:0 auto;padding:24px 16px calc(24px + env(safe-area-inset-bottom))}.card{background:#fff;border:1px solid #f3f4f6;border-radius:16px;padding:20px;box-shadow:0 1px 2px rgba(0,0,0,.04)}
h1{font-size:22px;letter-spacing:-.02em;margin:0 0 4px}.muted{color:#6b7280;font-size:14px}.amt{font-size:36px;font-weight:700;letter-spacing:-.02em;margin:16px 0}
.row{display:flex;justify-content:space-between;font-size:14px;padding:8px 0;border-top:1px solid #f3f4f6}.btn{display:block;width:100%;height:48px;border:0;border-radius:12px;font:600 15px Inter,sans-serif;margin-top:12px;cursor:pointer}
.p{background:#111827;color:#fff}.s{background:#f3f4f6;color:#111827}.badge{display:inline-block;background:#eef2ff;color:#4338ca;border-radius:999px;padding:3px 10px;font-size:12px;font-weight:600}
.ok{color:#059669}.err{color:#dc2626}#map{height:260px;border-radius:12px;background:#e5e7eb;margin-top:12px;overflow:hidden}
</style></head><body><div class="wrap">${body}</div></body></html>`;

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true);
  app.use((req, res, next) => {
    res.set('x-content-type-options', 'nosniff').set('referrer-policy', 'same-origin');
    res.set('access-control-allow-origin', '*').set('access-control-allow-headers', 'authorization, content-type, x-device-id').set('access-control-allow-methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  // webhooks need the raw body for the signature
  const raw = express.raw({ type: '*/*', limit: '200kb' });
  app.post('/api/webhooks/payment', raw, wrap(async (req, res) => {
    const body = req.body.toString('utf8');
    if (req.headers['x-signature'] !== webhookSignature(body)) throw new HttpError(401, 'Bad signature');
    res.json(await handlePaymentEvent(JSON.parse(body)));
  }));
  app.post('/api/webhooks/courier', raw, wrap(async (req, res) => {
    const body = req.body.toString('utf8');
    if (req.headers['x-signature'] !== webhookSignature(body, config.courierWebhookSecret)) throw new HttpError(401, 'Bad signature');
    res.json(await handleCourierEvent(JSON.parse(body)));
  }));

  app.use(express.json({ limit: '9mb' }));

  app.get('/health', wrap(async (_req, res) => {
    const db = await one('select now() t');
    const ai = await llmConfig();
    res.json({ ok: true, app: config.appName, db: !!db, ai: ai.enabled ? 'on' : 'off', sandbox: config.sandbox, time: db.t });
  }));

  app.use('/api/auth', limit('auth', 20, 60e3));
  app.use('/api/admin/auth', limit('admin-auth', 10, 60e3));
  app.use('/api/deals/:id/release-code', limit('code', 10, 60e3));
  app.use('/api/admin', adminRouter);

  // sandbox payment page (stands in for bKash / SSLCommerz checkout)
  app.get('/pay/:id', wrap(async (req, res) => {
    const p = await one('select p.*, d.title, d.buyer_id from payments p join deals d on d.id = p.deal_id where p.id = $1', [req.params.id]);
    if (!p) return res.status(404).send(page('Not found', '<div class="card"><h1>Payment not found</h1></div>'));
    const done = p.status !== 'initiated';
    res.send(page('Pay', `<div class="card"><span class="badge">Test payment · no real money</span><h1 style="margin-top:12px">Pay for your deal</h1><div class="muted">${escapeHtml(p.title)}</div>
      <div class="amt">${tk(p.amount_paisa)}</div><div class="row"><span>Paid to</span><b>${config.appName} escrow</b></div><div class="row"><span>Status</span><b id="st" class="${done ? (p.status === 'succeeded' ? 'ok' : 'err') : ''}">${p.status}</b></div>
      ${done ? '<p class="muted">You can close this page and go back to the app.</p>' : `<button class="btn p" onclick="go('succeeded')">Pay ${tk(p.amount_paisa)}</button><button class="btn s" onclick="go('failed')">Cancel</button>`}
      <p class="muted" style="font-size:12px;margin-top:16px">This is the test checkout. When a real payment provider is connected, this page is replaced by bKash, Nagad or card checkout.</p></div>
      <script>async function go(s){document.querySelectorAll('button').forEach(b=>b.disabled=true);const r=await fetch('/pay/${p.id}/complete',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({status:s})});const j=await r.json();document.getElementById('st').textContent=j.status||j.error;setTimeout(()=>{location.href='/app/?paid=${p.deal_id}'},700)}</script>`));
  }));
  app.post('/pay/:id/complete', wrap(async (req, res) => {
    if (config.paymentProvider !== 'sandbox') throw new HttpError(404, 'Not found');
    const p = await one('select * from payments where id = $1', [req.params.id]);
    if (!p) throw new HttpError(404, 'Not found');
    const status = req.body.status === 'succeeded' ? 'succeeded' : 'failed';
    await handlePaymentEvent({ provider_ref: p.provider_ref, status, amount_paisa: p.amount_paisa });
    res.json({ status });
  }));

  // public trip-share page (live location for a friend)
  app.get('/trip/:token', wrap(async (req, res) => {
    const t = await one(`select t.*, p.display_name, d.title from trip_shares t join profiles p on p.id = t.user_id join deals d on d.id = t.deal_id where share_token = $1`, [req.params.token]);
    if (!t || new Date(t.expires_at) < new Date()) return res.status(404).send(page('Trip ended', '<div class="card"><h1>This trip link has ended</h1><p class="muted">Links stop working after a few hours.</p></div>'));
    const has = t.lat != null;
    res.send(page('Trip', `<div class="card"><span class="badge">Live trip</span><h1 style="margin-top:12px">${escapeHtml(t.display_name)} is meeting someone</h1><p class="muted">For: ${escapeHtml(t.title)}. This link ends ${new Date(t.expires_at).toUTCString()}.</p>
      ${has ? `<div id="map"><iframe title="map" width="100%" height="260" style="border:0" src="https://www.openstreetmap.org/export/embed.html?bbox=${t.lng - 0.01},${t.lat - 0.006},${t.lng + 0.01},${t.lat + 0.006}&marker=${t.lat},${t.lng}"></iframe></div><p class="muted">Last updated ${new Date(t.updated_at).toUTCString()}</p>` : '<p class="muted">No location shared yet.</p>'}
      <p class="muted">If you can't reach them and you are worried, call 999.</p></div><script>setTimeout(()=>location.reload(),60000)</script>`));
  }));

  app.get('/api/deals/:id/contract.pdf', requireUser, wrap(async (req, res) => {
    await dealIsParty(req.params.id, req.user.id);
    const c = await one('select f.data from e_contracts e join files f on f.id = e.file_id where e.deal_id = $1', [req.params.id]);
    if (!c) throw new HttpError(404, 'No agreement yet');
    res.set('content-type', 'application/pdf').send(c.data);
  }));

  app.use('/api', userRouter);

  // static: landing page, user app (/app), admin app (/admin), downloads
  app.use('/download', express.static(path.join(pub, 'download'), { setHeaders: (res, p) => { if (p.endsWith('.apk')) res.set('content-type', 'application/vnd.android.package-archive'); } }));
  // The admin app is part of the same web build, at /app/admin. /admin is the short link to it.
  app.get(['/admin', '/admin/{*rest}'], (req, res) => {
    const rest = req.params.rest ? `/${[].concat(req.params.rest).join('/')}` : '';
    res.redirect(302, `/app/admin${rest}`);
  });
  for (const [mount, dir] of [['/app', 'app']]) {
    const d = path.join(pub, dir);
    app.use(mount, express.static(d, { index: 'index.html', maxAge: '1h', setHeaders: (res, p) => { if (p.endsWith('index.html')) res.set('cache-control', 'no-cache'); } }));
    app.get(`${mount}/{*rest}`, (req, res, next) => {
      if (path.extname(req.path)) return next();
      const f = path.join(d, 'index.html');
      if (fs.existsSync(f)) return res.set('cache-control', 'no-cache').sendFile(f);
      next();
    });
  }
  app.use('/', express.static(pub, { index: 'index.html', maxAge: '1h' }));

  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Not found')));
  app.use((err, _req, res, _next) => {
    const status = err.status || (err.type === 'entity.too.large' ? 413 : 500);
    if (status >= 500) console.error(err);
    let msg = status >= 500 ? 'Something went wrong on our side. Please try again.' : err.message;
    if (err.code === '23505') { res.status(409); return res.json({ error: 'That already exists.', code: 'duplicate' }); }
    if (err.code === '22P02') { res.status(400); return res.json({ error: 'Something in the request is not valid.', code: 'invalid' }); }
    if (err.code === 'P0001' || err.code === 'P0005' || err.code === 'P0006' || err.code === 'P0007') { res.status(409); return res.json({ error: err.message, code: err.code }); }
    res.status(status).json({ error: msg, code: err.code });
  });
  return app;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
