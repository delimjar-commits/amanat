import crypto from 'node:crypto';
import { config } from './config.js';
import { many, q } from './db.js';

let cache = null;
let cacheAt = 0;

export async function allSettings() {
  if (cache && Date.now() - cacheAt < 5000) return cache;
  const rows = await many('select key, value from settings');
  const s = { ...config.defaults };
  for (const r of rows) s[r.key] = r.value;
  cache = s;
  cacheAt = Date.now();
  return s;
}
export async function getSetting(key) {
  return (await allSettings())[key];
}
export async function setSettings(obj) {
  for (const [k, v] of Object.entries(obj)) {
    await q(
      `insert into settings(key, value, updated_at) values ($1, $2::jsonb, now())
       on conflict (key) do update set value = excluded.value, updated_at = now()`,
      [k, JSON.stringify(v)],
    );
  }
  cache = null;
}

// The AI key is stored encrypted (AES-256-GCM) with a key derived from JWT_SECRET.
const encKey = () => crypto.createHash('sha256').update(`ai-key:${config.jwtSecret}`).digest();
export function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', encKey(), iv);
  const enc = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return `g1:${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${enc.toString('base64')}`;
}
export function decrypt(blob) {
  try {
    const [v, iv, tag, enc] = String(blob || '').split(':');
    if (v !== 'g1') return '';
    const d = crypto.createDecipheriv('aes-256-gcm', encKey(), Buffer.from(iv, 'base64'));
    d.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(enc, 'base64')), d.final()]).toString('utf8');
  } catch {
    return '';
  }
}
