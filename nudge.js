// Scheduled reminders for the household chore board.
// Runs from GitHub Actions every ~20 minutes with the Firebase service account.
// - Daily nudge: at each person's chosen local time, a push with what's still open today.
// - Weekly wrap-up: Monday morning (local), last week's scores + this week's rotation.
// Nothing here is user-facing HTML; it only reads the database and calls FCM.

const { GoogleAuth } = require('google-auth-library');

const PROJECT = 'household-chores-73e50';
const DB = `https://${PROJECT}-default-rtdb.firebaseio.com`;
const HOUSE = 'houses/main';
const APP_URL = 'https://household-chores-73e50.web.app/';
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const catRe = /\bcats?\b|litter|kitt/i;

const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
if (!sa.client_email) { console.error('FIREBASE_SERVICE_ACCOUNT secret missing'); process.exit(1); }
const auth = new GoogleAuth({ credentials: sa, scopes: ['https://www.googleapis.com/auth/firebase.database', 'https://www.googleapis.com/auth/userinfo.email', 'https://www.googleapis.com/auth/firebase.messaging'] });

async function token() { const c = await auth.getClient(); const t = await c.getAccessToken(); return t.token || t; }
async function dbGet(path) { const r = await fetch(`${DB}/${path}.json`, { headers: { Authorization: `Bearer ${await token()}` } }); if (!r.ok) throw new Error(`DB GET ${path}: ${r.status} ${await r.text()}`); return r.json(); }
async function dbPatch(path, body) { const r = await fetch(`${DB}/${path}.json`, { method: 'PATCH', headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); if (!r.ok) throw new Error(`DB PATCH ${path}: ${r.status} ${await r.text()}`); }
async function dbDelete(path) { await fetch(`${DB}/${path}.json`, { method: 'DELETE', headers: { Authorization: `Bearer ${await token()}` } }); }

// ---- local-time helpers (per person's timezone) ----
function localParts(tz, d = new Date()) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour12: false, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  const o = {}; f.formatToParts(d).forEach(p => o[p.type] = p.value);
  const hour = o.hour === '24' ? 0 : +o.hour;
  return { date: `${o.year}-${o.month}-${o.day}`, minutes: hour * 60 + (+o.minute), dow: (['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(o.weekday)), y: +o.year, m: +o.month, d: +o.day };
}
// Week keys must match the app: Monday-start, in the person's local calendar.
function weekStartLocal(lp) { const dt = new Date(Date.UTC(lp.y, lp.m - 1, lp.d)); dt.setUTCDate(dt.getUTCDate() - lp.dow); return dt; }
function keyOf(dt) { return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`; }
function weekIndexOf(dt) { const epoch = Date.UTC(2024, 0, 1); const e = new Date(epoch); e.setUTCDate(e.getUTCDate() - ((e.getUTCDay() + 6) % 7)); return Math.floor((dt.getTime() - e.getTime()) / (7 * 864e5)); }
const targetFor = t => t.freq >= 1 ? Math.round(t.freq) : 1;
const whoRaw = v => v === 'rot' ? 'rot' : (v === undefined || v === null || v === -1 || v === '' ? -1 : +v);

function rotAssignee(tasks, t, wk) { const rots = tasks.filter(x => x.on !== false && whoRaw(x.who) === 'rot'); const i = rots.indexOf(t); return ((wk + Math.max(0, i)) % 3 + 3) % 3; }
function assignee(tasks, t, wk) { const w = whoRaw(t.who); return w === 'rot' ? rotAssignee(tasks, t, wk) : w; }

async function sendPush(tok, data) {
  const r = await fetch(`https://fcm.googleapis.com/v1/projects/${PROJECT}/messages:send`, {
    method: 'POST', headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: { token: tok, data, webpush: { headers: { Urgency: 'normal', TTL: '3600' }, fcm_options: { link: data.url || APP_URL } } } })
  });
  if (r.ok) return 'ok';
  const txt = await r.text();
  if (r.status === 404 || /UNREGISTERED|NOT_FOUND|InvalidRegistration/i.test(txt)) return 'gone';
  console.error('FCM error', r.status, txt.slice(0, 300)); return 'error';
}

(async () => {
  const house = await dbGet(HOUSE); if (!house) { console.log('no house data'); return; }
  const people = house.people || ['Person 1', 'Person 2', 'Person 3'];
  const tasks = Object.entries(house.tasks || {}).map(([id, t]) => ({ id, ...t })).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).filter(t => t.on !== false);
  const checks = house.checks || {}; const prefs = house.prefs || {}; const nudged = house.nudged || {}; const wrapped = house.wrapped || {};
  const alerts = house.alerts || {}; const alertDone = house.alertDone || {}; const alerted = house.alerted || {};
  const now = new Date(); let sent = 0;

  for (const slot of [0, 1, 2]) {
    const p = prefs[slot]; if (!p || !p.reminders) continue;
    const r = p.reminders; const tokens = Object.entries(p.push || {}); if (!tokens.length) continue;
    const tz = r.tz || 'America/New_York'; const lp = localParts(tz, now);
    const wkStart = weekStartLocal(lp); const wkKey = keyOf(wkStart); const wk = weekIndexOf(wkStart);
    const name = people[slot] || `Person ${slot + 1}`;
    const deliver = async (data, dedupePath) => {
      let ok = false;
      for (const [k, v] of tokens) { const res = await sendPush(v.token, data); if (res === 'gone') await dbDelete(`${HOUSE}/prefs/${slot}/push/${k}`); if (res === 'ok') ok = true; }
      if (ok) { await dbPatch(dedupePath, { ts: Date.now() }); sent++; }
    };

    // ---- daily nudge ----
    if (r.daily) {
      const [hh, mm] = String(r.time || '18:00').split(':').map(Number); const at = hh * 60 + mm;
      const inWindow = lp.minutes >= at && lp.minutes < at + 45; // cron may be late by a few minutes
      const already = nudged[slot] && nudged[slot][lp.date];
      if (inWindow && !already) {
        const mine = tasks.filter(t => assignee(tasks, t, wk) === slot);
        const todays = mine.filter(t => targetFor(t) >= 5 && !((checks[wkKey] || {})[t.id] || {})[lp.dow]);
        const weekly = mine.filter(t => targetFor(t) < 5 && t.freq >= 1 && Object.keys((checks[wkKey] || {})[t.id] || {}).length < targetFor(t));
        const catsLeft = todays.filter(t => catRe.test(t.name));
        if (todays.length || (lp.dow >= 5 && weekly.length)) {
          const parts = [];
          if (todays.length) parts.push(`${todays.length} left today: ${todays.slice(0, 3).map(t => t.name).join(', ')}${todays.length > 3 ? '…' : ''}`);
          if (lp.dow >= 5 && weekly.length) parts.push(`${weekly.length} weekly task${weekly.length === 1 ? '' : 's'} still open this week`);
          const title = catsLeft.length ? `🐈 The cats are waiting — ${catsLeft[0].name.toLowerCase()}` : `Hey ${name}, quick check-in`;
          await deliver({ title, body: parts.join(' · '), url: APP_URL + '?view=week', tag: 'daily' }, `${HOUSE}/nudged/${slot}/${lp.date}`);
        } else {
          await dbPatch(`${HOUSE}/nudged/${slot}/${lp.date}`, { ts: Date.now(), skipped: true }); // all done — stay quiet
        }
      }
    }

    // ---- house alerts (e.g. cardboard out on Thursday) ----
    for (const [aid, a] of Object.entries(alerts)) {
      if (!a || !(p.alerts && p.alerts[aid])) continue;
      if (a.dow !== lp.dow) continue;
      const [ah, am] = String(a.time || '18:00').split(':').map(Number); const at = ah * 60 + am;
      if (!(lp.minutes >= at && lp.minutes < at + 45)) continue;
      if (alerted[slot] && alerted[slot][wkKey] && alerted[slot][wkKey][aid]) continue;
      if (alertDone[wkKey] && alertDone[wkKey][aid]) { await dbPatch(`${HOUSE}/alerted/${slot}/${wkKey}`, { [aid]: { ts: Date.now(), skipped: true } }); continue; } // already handled
      await deliver({ title: `${a.emoji || '🔔'} ${a.name}`, body: a.note || `It's ${DAYS[a.dow]} — time to take care of this.`, url: APP_URL + '?view=week', tag: 'alert-' + aid }, `${HOUSE}/alerted/${slot}/${wkKey}/${aid}`);
    }

    // ---- weekly wrap-up (Monday, 8:00–12:00 local, once) ----
    if (r.wrap !== false && lp.dow === 0 && lp.minutes >= 8 * 60 && lp.minutes < 12 * 60 && !(wrapped[slot] && wrapped[slot][wkKey])) {
      const last = new Date(wkStart); last.setUTCDate(last.getUTCDate() - 7); const lastKey = keyOf(last); const lastWk = weekIndexOf(last);
      const lastChecks = checks[lastKey] || {};
      const active = tasks.filter(t => t.freq >= 1);
      const sum = [0, 1, 2].map(i => { const mine = active.filter(t => assignee(tasks, t, lastWk) === i); const planned = mine.reduce((a, t) => a + t.effort * targetFor(t), 0); const done = mine.reduce((a, t) => a + t.effort * Math.min(Object.keys(lastChecks[t.id] || {}).length, targetFor(t)), 0); return { i, pct: planned ? Math.round(done / planned * 100) : 0, planned }; });
      const line = sum.filter(s => s.planned > 0).map(s => `${people[s.i]} ${s.pct}%`).join(' · ');
      const rots = tasks.filter(t => whoRaw(t.who) === 'rot');
      const rotLine = rots.length ? ` This week's rotation: ${rots.slice(0, 3).map(t => `${t.name} → ${people[rotAssignee(tasks, t, wk)]}`).join(', ')}.` : '';
      if (Object.keys(lastChecks).length) {
        await deliver({ title: '📬 Last week\'s wrap-up', body: `${line || 'No check-offs recorded'}.${rotLine}`, url: APP_URL + '?view=stats', tag: 'wrap' }, `${HOUSE}/wrapped/${slot}/${wkKey}`);
        // one shared activity entry per week
        if (!(house.wraplog && house.wraplog[wkKey])) {
          const key = 'w' + Date.now();
          await dbPatch(`${HOUSE}/log`, { [key]: { by: null, name: 'Weekly wrap-up', text: `${line}.${rotLine}`, ts: Date.now(), kind: 'wrap' } });
          await dbPatch(`${HOUSE}/wraplog`, { [wkKey]: Date.now() });
        }
      } else {
        await dbPatch(`${HOUSE}/wrapped/${slot}/${wkKey}`, { ts: Date.now(), skipped: true });
      }
    }
  }
  console.log(`done — ${sent} notification batch(es) sent`);
})().catch(e => { console.error(e); process.exit(1); });
