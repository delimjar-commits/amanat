import crypto from 'node:crypto';
import { config } from './config.js';
import { one } from './db.js';

export class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
export const bad = (msg, code) => new HttpError(400, msg, code);

// ---- passwords (scrypt) ----
export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(pw, salt, 32, { N: 16384 });
  return `s1$${salt.toString('base64')}$${key.toString('base64')}`;
}
export function verifyPassword(pw, stored) {
  const [v, s, k] = String(stored || '').split('$');
  if (v !== 's1') return false;
  const key = crypto.scryptSync(pw, Buffer.from(s, 'base64'), 32, { N: 16384 });
  const want = Buffer.from(k, 'base64');
  return want.length === key.length && crypto.timingSafeEqual(key, want);
}

// ---- tokens (HS256 JWT) ----
const b64u = (b) => Buffer.from(b).toString('base64url');
export function signToken(payload, ttlSec = 60 * 60 * 24 * 30) {
  const head = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64u(JSON.stringify({ ...payload, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + ttlSec }));
  const sig = crypto.createHmac('sha256', config.jwtSecret).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}
export function verifyToken(tok) {
  const [h, b, s] = String(tok || '').split('.');
  if (!h || !b || !s) return null;
  const want = crypto.createHmac('sha256', config.jwtSecret).update(`${h}.${b}`).digest('base64url');
  if (want.length !== s.length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(s))) return null;
  try {
    const p = JSON.parse(Buffer.from(b, 'base64url').toString());
    if (p.exp && p.exp < Date.now() / 1000) return null;
    return p;
  } catch {
    return null;
  }
}

function bearer(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}

export function requireUser(req, _res, next) {
  (async () => {
    const p = verifyToken(bearer(req));
    if (!p || p.aud !== 'user') throw new HttpError(401, 'Please sign in again.');
    const u = await one('select * from profiles where id = $1', [p.sub]);
    if (!u || u.deleted_at) throw new HttpError(401, 'Please sign in again.');
    if (u.is_banned) throw new HttpError(403, 'This account is suspended. Contact support if you think this is a mistake.', 'banned');
    req.user = u;
  })().then(() => next(), next);
}

// Admin tokens carry aud=admin and mfa=true only after the 2FA code is checked.
export function requireAdmin(req, _res, next) {
  (async () => {
    const p = verifyToken(bearer(req));
    if (!p || p.aud !== 'admin' || !p.mfa) throw new HttpError(401, 'Admin sign-in with 2FA required.');
    const a = await one(
      `select a.*, p.email, p.display_name from admin_users a join profiles p on p.id = a.user_id where a.user_id = $1 and a.active and not p.is_banned`,
      [p.sub],
    );
    if (!a) throw new HttpError(403, 'Not an admin.');
    req.admin = a;
  })().then(() => next(), next);
}

export const requireRole = (...roles) => (req, _res, next) => {
  if (req.admin.role === 'super_admin' || roles.includes(req.admin.role)) return next();
  next(new HttpError(403, `This needs the ${roles.join(' or ')} role.`));
};

// ---- TOTP (RFC 6238) ----
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
function base32Decode(s) {
  let bits = 0, value = 0; const out = [];
  for (const ch of s.replace(/=+$/, '').toUpperCase()) {
    const i = B32.indexOf(ch); if (i < 0) continue;
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}
export function totpAt(secret, t = Date.now()) {
  const counter = Math.floor(t / 1000 / 30);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', base32Decode(secret)).update(buf).digest();
  const o = h[h.length - 1] & 15;
  const code = ((h.readUInt32BE(o) & 0x7fffffff) % 1000000).toString().padStart(6, '0');
  return code;
}
export function verifyTotp(secret, code) {
  const c = String(code || '').replace(/\s/g, '');
  return [-1, 0, 1].some((w) => totpAt(secret, Date.now() + w * 30000) === c);
}
export const newTotpSecret = () => base32Encode(crypto.randomBytes(20));

// ---- misc hashing ----
export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
export const nidHash = (nid) => crypto.createHmac('sha256', config.nidPepper).update(String(nid).replace(/\D/g, '')).digest('hex');

// signed, expiring file URLs (private buckets)
export function signFile(id, ttlSec = 3600) {
  if (!id) return null;
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const sig = crypto.createHmac('sha256', config.fileSecret).update(`${id}.${exp}`).digest('base64url').slice(0, 32);
  return `/api/files/${id}?exp=${exp}&sig=${sig}`;
}
export function checkFileSig(id, exp, sig) {
  if (!exp || !sig || Number(exp) < Date.now() / 1000) return false;
  const want = crypto.createHmac('sha256', config.fileSecret).update(`${id}.${exp}`).digest('base64url').slice(0, 32);
  return want.length === String(sig).length && crypto.timingSafeEqual(Buffer.from(want), Buffer.from(String(sig)));
}

// 4-digit release code: derived from a server secret, so the database stores only its hash
export function releaseCodeFor(dealId) {
  const h = crypto.createHmac('sha256', config.releaseCodeSecret).update(`release:${dealId}`).digest();
  return String(h.readUInt32BE(0) % 10000).padStart(4, '0');
}
export function releaseCodeHash(code, salt) {
  return crypto.createHash('sha256').update(`${salt}:${code}`).digest('hex');
}
