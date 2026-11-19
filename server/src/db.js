import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';

pg.types.setTypeParser(20, (v) => Number(v)); // bigint -> number (paisa values stay well inside 2^53)
pg.types.setTypeParser(1700, (v) => Number(v)); // numeric -> number

const needsSsl = /neon\.tech|sslmode=require/.test(config.databaseUrl);
export const pool = new pg.Pool({
  connectionString: config.databaseUrl.replace(/([?&])channel_binding=require&?/, '$1').replace(/[?&]$/, ''),
  ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
  max: Number(process.env.PG_POOL_MAX || 8),
  idleTimeoutMillis: 30000,
});
pool.on('error', (e) => console.error('pg pool error', e.message));

export const q = (text, params) => pool.query(text, params);
export const one = async (text, params) => (await pool.query(text, params)).rows[0] || null;
export const many = async (text, params) => (await pool.query(text, params)).rows;

// Run fn inside one transaction. The client gets one/many helpers too.
export async function tx(fn) {
  const client = await pool.connect();
  const c = {
    query: (t, p) => client.query(t, p),
    one: async (t, p) => (await client.query(t, p)).rows[0] || null,
    many: async (t, p) => (await client.query(t, p)).rows,
  };
  try {
    await client.query('begin');
    const out = await fn(c);
    await client.query('commit');
    return out;
  } catch (e) {
    await client.query('rollback').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

const here = path.dirname(fileURLToPath(import.meta.url));
export async function migrate() {
  await q('create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())');
  const dir = path.join(here, '..', 'migrations');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    const done = await one('select 1 from schema_migrations where name = $1', [f]);
    if (done) continue;
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    await tx(async (c) => {
      await c.query(sql);
      await c.query('insert into schema_migrations(name) values ($1)', [f]);
    });
    console.log('migrated', f);
  }
}
