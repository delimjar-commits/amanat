import { createApp } from './app.js';
import { migrate, q } from './db.js';
import { config } from './config.js';
import { startJobs } from './jobs.js';

const SPOTS = [
  ['Bashundhara City Shopping Mall (main gate)', 'Panthapath, Dhaka', 'Busy, guarded, CCTV at the gate', 23.7509, 90.3905],
  ['Jamuna Future Park (gate 1)', 'Kuril, Dhaka', 'Security desk inside the gate', 23.8135, 90.4243],
  ['Dhanmondi Police Station (front)', 'Dhanmondi, Dhaka', 'Meet at the front, in daylight', 23.7465, 90.3746],
  ['Gulshan 1 DCC Market (front)', 'Gulshan, Dhaka', 'Busy crossing, shops open late', 23.7808, 90.4167],
  ['Uttara Sector 7 Park (main gate)', 'Uttara, Dhaka', 'Busy evenings', 23.8697, 90.3926],
  ['GEC Circle (Central Plaza front)', 'GEC, Chattogram', 'Busy commercial area', 22.3593, 91.8215],
  ['Zindabazar (Blue Water Shopping City)', 'Sylhet', 'Mall entrance, guarded', 24.8963, 91.8697],
];

async function main() {
  await migrate();
  const { n } = (await q('select count(*)::int n from safe_spots')).rows[0];
  if (!n) for (const s of SPOTS) await q('insert into safe_spots(name, area, note, lat, lng) values ($1,$2,$3,$4,$5)', s);
  if (!config.adminEmails.length) console.warn('ADMIN_EMAILS is empty: nobody can open the admin app.');
  const app = createApp();
  app.listen(config.port, () => console.log(`${config.appName} listening on ${config.port}`));
  if (config.jobs) startJobs();
}
main().catch((e) => { console.error(e); process.exit(1); });
