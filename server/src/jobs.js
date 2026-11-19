// Background jobs. On the free Render plan the server sleeps when idle, so each job also runs
// once at boot and can be started by hand from the admin app.
import { q, one, many, tx } from './db.js';
import { allSettings } from './settings.js';
import { config } from './config.js';
import { alert, notify, computeTrust, sysMessage, handleCourierEvent } from './services.js';
import { fraudReport, riskForDeal } from './agents.js';

const state = {};

const JOBS = {
  // shipped + delivered more than auto_release_hours ago and no dispute: queue release for admin
  'auto-release': { every: 10 * 60e3, fn: async () => {
    const s = await allSettings();
    const due = await many(`select id from deals where status = 'shipped' and delivered_at is not null and delivered_at < now() - make_interval(hours => $1)`, [Number(s.auto_release_hours)]);
    let n = 0;
    for (const d of due) {
      await tx(async (c) => {
        const deal = await c.one('select * from deals where id = $1 for update', [d.id]);
        if (deal.status !== 'shipped') return;
        await c.query(`select transition_deal($1, 'release_queued', null, 'system', 'Auto-release: delivered and no dispute in time')`, [deal.id]);
        const risk = await riskForDeal(c, deal);
        const r = await c.one(`insert into ai_reviews(agent, subject_type, subject_id, recommendation, confidence, risk_score, summary, evidence, model) values ('deal_verifier','deal',$1,'release',0.9,$2,$3,$4,'rules') returning id`,
          [deal.id, risk.score, `Delivered ${deal.delivered_at.toISOString().slice(0, 16)} and no dispute within ${s.auto_release_hours} hours.`, JSON.stringify({ checks: [{ name: 'Courier delivered', pass: true, detail: deal.tracking_number }, { name: 'No dispute in time', pass: true, detail: `${s.auto_release_hours} hours` }], risk_reasons: risk.reasons })]);
        await c.query(`insert into admin_actions(type, subject_type, subject_id, payload, ai_review_id, priority, requested_by) values ('release_escrow','deal',$1,$2,$3,2,'system:auto-release')`, [deal.id, JSON.stringify({ amount_paisa: deal.amount_paisa, risk_score: risk.score, auto_release: true }), r.id]);
        await sysMessage(c, deal.chat_id, 'No dispute was opened in time, so the release is waiting for admin approval.', deal.id);
        n++;
      });
    }
    return `${n} deal(s) queued for release`;
  } },
  // sandbox courier: parcels marked delivered after a set number of minutes
  'courier-sandbox': { every: 5 * 60e3, fn: async () => {
    if (config.courierProvider !== 'sandbox') return 'real courier: webhooks only';
    const s = await allSettings();
    const rows = await many(`select tracking_number from deals where status = 'shipped' and delivered_at is null and tracking_number is not null and (select max(created_at) from deal_events e where e.deal_id = deals.id and e.to_status = 'shipped') < now() - make_interval(mins => $1)`, [Number(s.courier_sandbox_deliver_minutes)]);
    for (const r of rows) await handleCourierEvent({ tracking_number: r.tracking_number, status: 'delivered' });
    return `${rows.length} parcel(s) delivered`;
  } },
  // daily: ledger hash chain + balances vs deal states
  'ledger-reconcile': { every: 6 * 3600e3, fn: async () => {
    const v = await one('select * from ledger_verify()');
    const escrow = await one(`select coalesce(sum(debit_paisa - credit_paisa),0)::bigint b from ledger_entries where account = 'escrow_hold'`);
    const held = await one(`select coalesce(sum(amount_paisa),0)::bigint b from deals where status in ('funded','handover_pending','shipped','buyer_confirmed','release_queued','disputed','refund_queued','split_queued')`);
    const problems = [];
    if (!v.ok) problems.push(`hash chain or balance broken (first bad entry ${v.broken_id}, unbalanced txns ${v.unbalanced_txns})`);
    if (escrow.b !== held.b) problems.push(`escrow balance ${escrow.b / 100} BDT does not match open deals ${held.b / 100} BDT`);
    if (problems.length) await tx((c) => alert(c, { kind: 'ledger', priority: 0, title: 'Ledger check failed', body: problems.join('; '), data: { verify: v, escrow: escrow.b, held: held.b } }));
    return problems.length ? `PROBLEM: ${problems.join('; ')}` : `ok: ${v.entries} entries, escrow ${escrow.b / 100} BDT matches`;
  } },
  'trust-recompute': { every: 24 * 3600e3, fn: async () => {
    const users = await many(`select id from profiles where deleted_at is null and (deals_completed > 0 or exists (select 1 from reports r where r.target_user_id = profiles.id))`);
    for (const u of users) await tx((c) => computeTrust(c, u.id));
    return `${users.length} user(s) recomputed`;
  } },
  'fraud-report': { every: 24 * 3600e3, fn: async () => {
    const last = await one(`select created_at from ai_reviews where agent = 'fraud_report' order by created_at desc limit 1`);
    if (last && Date.now() - new Date(last.created_at) < 20 * 3600e3) return 'already ran in the last 20 hours';
    await tx((c) => fraudReport(c));
    return 'report written';
  } },
  // KYC images older than 90 days after a decision; accounts 7 days after a delete request
  'retention': { every: 24 * 3600e3, fn: async () => {
    const del = await many(`select id from profiles where delete_requested_at < now() - interval '7 days' and deleted_at is null`);
    for (const u of del) {
      await q(`update profiles set deleted_at = now(), email = 'deleted+' || id || '@invalid', display_name = 'Deleted user', phone = null, bio = null, avatar_file = null, password_hash = 'deleted' where id = $1`, [u.id]);
      await q(`delete from files where owner_id = $1 and bucket in ('avatars','chat-media','listing-photos')`, [u.id]);
    }
    return `${del.length} account(s) deleted`;
  } },
  'sos-escalate': { every: 60e3, fn: async () => {
    const open = await many(`select a.id from alerts a where a.kind = 'sos' and a.resolved_at is null and a.created_at < now() - interval '5 minutes' and coalesce((a.data->>'escalated')::boolean, false) = false`);
    for (const a of open) await tx((c) => alert(c, { kind: 'sos_escalation', priority: 0, subject_type: 'alert', subject_id: a.id, title: 'SOS not handled for 5 minutes', body: 'Call the user and, if needed, 999.' }));
    if (open.length) await q(`update alerts set data = coalesce(data,'{}'::jsonb) || '{"escalated":true}' where id = any($1)`, [open.map((x) => x.id)]);
    return `${open.length} escalated`;
  } },
};

export async function runJob(name) {
  const j = JOBS[name];
  if (!j) throw new Error('Unknown job');
  const started = Date.now();
  try {
    const r = await j.fn();
    state[name] = { ok: true, result: r, at: new Date().toISOString(), ms: Date.now() - started };
  } catch (e) {
    state[name] = { ok: false, result: e.message, at: new Date().toISOString(), ms: Date.now() - started };
  }
  return state[name];
}
export function jobStatus() {
  return Object.keys(JOBS).map((name) => ({ name, every_minutes: Math.round(JOBS[name].every / 60e3), ...(state[name] || {}) }));
}
export function startJobs() {
  const timers = [];
  for (const [name, j] of Object.entries(JOBS)) {
    timers.push(setTimeout(() => runJob(name), 5000 + Math.random() * 5000));
    timers.push(setInterval(() => runJob(name), j.every));
  }
  return () => timers.forEach((t) => clearInterval(t));
}
