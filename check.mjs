// Runs one round of checks against every site in sites.json and updates data/.
// Pure logic lives in lib/; this file is the I/O shell.
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { lookup } from 'node:dns/promises';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import tls from 'node:tls';
import { classify, daysUntil, pickSample, DEFAULTS } from './lib/status.mjs';
import { appendSample, rollDaily, buildLatest, recent } from './lib/aggregate.mjs';
import { detectTransitions, alertable, formatAlert } from './lib/transitions.mjs';
import { updateIncidents, attachDiagnosis, openIncident } from './lib/incidents.mjs';
import { apexDomain, rdapUrl, parseRdapExpiry } from './lib/domain.mjs';
import { visibleText } from './lib/render.mjs';
import { diagnoseIncident } from './lib/claude.mjs';

const execFile = promisify(execFileCb);
const ROOT = new URL('.', import.meta.url);
const DATA = new URL('data/', ROOT);
const HISTORY = new URL('history/', DATA);
const UA = 'WD-Monitor/2.0 (+https://williamsdigital.io)';
const DASHBOARD = 'https://williamsdigital.io/wd-monitor/';
const TIMEOUT_MS = 15_000;
const CONCURRENCY = 6;
const RENDER_CONCURRENCY = 3;
const RETRIES = 2;            // extra attempts before a site is declared down
const RETRY_GAP_MS = 10_000;
const DOMAIN_TTL_SEC = 24 * 3600;
// Analytics and tracking hosts the render check must never reach: the point is to see the page, not to count as a visitor.
const BLOCKED_HOSTS = ['*.google-analytics.com', '*.googletagmanager.com', '*.analytics.google.com', 'plausible.io', '*.clarity.ms', '*.hotjar.com',
  'connect.facebook.net', '*.doubleclick.net', 'vitals.vercel-insights.com', 'va.vercel-scripts.com', '*.posthog.com', '*.segment.com', '*.segment.io',
  '*.mixpanel.com', '*.fullstory.com', '*.sentry.io', '*.cloudfront.net.analytics', 'stats.g.doubleclick.net'];

const log = (...a) => console.log(...a);
const nowSec = () => Math.floor(Date.now() / 1000);
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function readJson(url, fallback) {
  try { return JSON.parse(await readFile(url, 'utf8')); } catch { return fallback; }
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const idx = i++; results[idx] = await fn(items[idx], idx); }
  }));
  return results;
}

function limiter(n) {
  let active = 0; const queue = [];
  const next = () => {
    if (active >= n || !queue.length) return;
    active++;
    const { fn, resolve, reject } = queue.shift();
    fn().then(resolve, reject).finally(() => { active--; next(); });
  };
  return fn => new Promise((resolve, reject) => { queue.push({ fn, resolve, reject }); next(); });
}
const renderLimit = limiter(RENDER_CONCURRENCY);

// ---------- probes ----------

async function fetchTimed(url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  const start = performance.now();
  try {
    const res = await fetch(url, { signal: ctl.signal, redirect: 'follow', headers: { 'user-agent': UA, accept: 'text/html,*/*' } });
    const body = await res.text();
    return { status: res.status, ms: Math.round(performance.now() - start), body, final: res.url };
  } catch (e) {
    return { status: 0, ms: Math.round(performance.now() - start), body: '', error: e.name === 'AbortError' ? `timeout after ${TIMEOUT_MS / 1000}s` : (e.cause?.code || e.message) };
  } finally {
    clearTimeout(timer);
  }
}

function certDays(host) {
  return new Promise(resolve => {
    const sock = tls.connect({ host, port: 443, servername: host, timeout: 10_000 }, () => {
      const cert = sock.getPeerCertificate();
      sock.end();
      resolve(cert?.valid_to ? daysUntil(cert.valid_to) : null);
    });
    sock.on('error', () => resolve(null));
    sock.on('timeout', () => { sock.destroy(); resolve(null); });
  });
}

let CHROME = null;
async function findChrome() {
  const candidates = [process.env.CHROME_BIN, 'google-chrome', 'google-chrome-stable', 'chromium-browser', 'chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].filter(Boolean);
  for (const c of candidates) {
    try { await execFile(c, ['--version'], { timeout: 10_000 }); return c; } catch { /* try the next one */ }
  }
  return null;
}

// Visible characters after JavaScript has run, or null when the render itself could not be done (never treated as blank).
async function renderedChars(url) {
  if (!CHROME) return null;
  const dir = await mkdtemp(join(tmpdir(), 'wdm-'));
  try {
    const { stdout } = await execFile(CHROME, [
      '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
      '--disable-sync', '--hide-scrollbars', '--mute-audio', `--user-data-dir=${dir}`, '--window-size=1280,900',
      `--user-agent=Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/130.0 Safari/537.36 ${UA}`,
      `--host-resolver-rules=${BLOCKED_HOSTS.map(h => `MAP ${h} ~NOTFOUND`).join(', ')}`,
      '--virtual-time-budget=8000', '--timeout=25000', '--dump-dom', url,
    ], { timeout: 45_000, maxBuffer: 32 * 1024 * 1024 });
    return visibleText(stdout).length;
  } catch (e) {
    log(`  render skipped for ${url}: ${e.code || e.message?.split('\n')[0]}`);
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function noteFor(out, site, pathResults) {
  if (out.error) return out.error;
  if (!out.status || out.status >= 400) return `HTTP ${out.status}`;
  if (out.expectOk === false) return `expected text "${site.expect}" not found`;
  if (typeof out.sslDays === 'number' && out.sslDays < 0) return 'certificate expired';
  if (typeof out.domainDays === 'number' && out.domainDays < 0) return 'domain registration expired';
  if (typeof out.renderChars === 'number' && out.renderChars < DEFAULTS.minRenderChars) return `page renders blank (${out.renderChars} characters of text)`;
  if (out.ms > DEFAULTS.slowMs) return `slow: ${out.ms} ms`;
  if (typeof out.sslDays === 'number' && out.sslDays < DEFAULTS.sslWarnDays) return `certificate expires in ${out.sslDays} days`;
  if (typeof out.domainDays === 'number' && out.domainDays < DEFAULTS.domainWarnDays) return `domain expires in ${out.domainDays} days`;
  const failed = pathResults.find(p => !p.ok);
  if (failed) return `${failed.path} ${failed.error ? failed.error : `returned HTTP ${failed.status}`}`;
  return undefined;
}

async function probeOnce(site, domainDays) {
  const host = new URL(site.url).hostname;
  const t = nowSec();
  const out = { status: 0, ms: 0, sslDays: null, domainDays, expectOk: undefined, error: undefined, final: undefined, renderChars: undefined, pathsOk: undefined };
  let body = '';
  try { await lookup(host); } catch (e) { out.error = `DNS: ${e.code || e.message}`; }
  if (!out.error) {
    const r = await fetchTimed(site.url);
    out.status = r.status; out.ms = r.ms; out.error = r.error; body = r.body;
    if (r.final && new URL(r.final).hostname !== host) out.final = r.final;
    if (!r.error && site.expect) out.expectOk = body.includes(site.expect);
    out.sslDays = await certDays(host);
  }
  let pathResults = [];
  if (!out.error && out.status && out.status < 400) {
    const [rendered, paths] = await Promise.all([
      renderLimit(() => renderedChars(site.url)),
      Promise.all((site.paths || []).map(async p => {
        const r = await fetchTimed(new URL(p.path, site.url).href);
        const ok = !r.error && r.status < 400 && (!p.expect || r.body.includes(p.expect));
        return { path: p.path, status: r.status, ms: r.ms, ok, ...(r.error ? { error: r.error } : {}) };
      })),
    ]);
    if (rendered !== null) out.renderChars = Math.max(rendered, visibleText(body).length);
    pathResults = paths;
    if (paths.length) out.pathsOk = paths.every(p => p.ok);
  }
  const s = classify(out);
  const sample = { t, s, ms: out.ms, code: out.status, ssl: out.sslDays };
  if (typeof domainDays === 'number') sample.dom = domainDays;
  if (typeof out.renderChars === 'number') sample.rc = out.renderChars;
  const note = noteFor(out, site, pathResults);
  if (note) sample.note = note;
  if (out.final) sample.final = out.final;
  const failed = pathResults.filter(p => !p.ok);
  if (failed.length) sample.paths = failed.map(p => ({ path: p.path, status: p.status, ...(p.error ? { error: p.error } : {}) }));
  return { sample, pathResults };
}

// A site is only declared down after every attempt fails; one good reading wins.
async function probe(site, domainDays) {
  const attempts = [];
  for (let i = 0; i <= RETRIES; i++) {
    if (i) { log(`  retrying ${site.name} (${attempts[i - 1].sample.note}) in ${RETRY_GAP_MS / 1000}s`); await sleep(RETRY_GAP_MS); }
    const r = await probeOnce(site, domainDays);
    attempts.push(r);
    if (r.sample.s !== 'down') break;
  }
  const sample = pickSample(attempts.map(a => a.sample));
  const chosen = attempts.find(a => a.sample === sample);
  if (attempts.length > 1) sample.tries = attempts.length;
  return { sample, attempts: attempts.map(a => a.sample), pathResults: chosen.pathResults };
}

// ---------- domain expiry (RDAP, refreshed once a day per registered domain) ----------

async function rdapLookup(apex) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(rdapUrl(apex), { headers: { accept: 'application/rdap+json, application/json', 'user-agent': UA }, signal: AbortSignal.timeout(20_000), redirect: 'follow' });
    if (res.status === 429 && attempt === 0) { await sleep(6000); continue; }
    const json = res.ok ? await res.json() : null;
    const ev = json?.events?.find?.(e => e.eventAction === 'expiration');
    return ev?.eventDate ? { expiresAt: ev.eventDate } : { error: `RDAP ${res.status}: no expiration event` };
  }
  return { error: 'RDAP rate limited' };
}

// One registry query at a time: rdap.org answers 429 to bursts, and a day-old answer is fine.
async function refreshDomains(sites, cache, now) {
  const apexes = [...new Set(sites.map(s => apexDomain(new URL(s.url).hostname)).filter(Boolean))];
  const next = { ...cache };
  for (const apex of apexes) {
    const c = cache[apex];
    if (c?.expiresAt && c.checkedAt && now - c.checkedAt < DOMAIN_TTL_SEC) continue;
    try {
      const r = await rdapLookup(apex);
      next[apex] = r.expiresAt ? { expiresAt: r.expiresAt, checkedAt: now } : { ...(c || {}), checkedAt: now - DOMAIN_TTL_SEC + 3600, error: r.error };
    } catch (e) {
      next[apex] = { ...(c || {}), checkedAt: now - DOMAIN_TTL_SEC + 3600, error: e.message };
    }
    await sleep(1000);
  }
  return next;
}

function domainDaysFor(host, domains, nowMs) {
  const apex = apexDomain(host);
  const d = apex && domains[apex];
  if (!d?.expiresAt) return null;
  return parseRdapExpiry({ events: [{ eventAction: 'expiration', eventDate: d.expiresAt }] }, nowMs);
}

// ---------- alerts ----------

async function notify(alert, diagnoses) {
  let body = alert.body;
  if (diagnoses.length) body += '\n\n' + diagnoses.map(d => `${d.name}: ${d.summary} Likely cause: ${d.likelyCause}`).join('\n');
  const tasks = [];
  if (process.env.NTFY_TOPIC) {
    tasks.push(fetch(`https://ntfy.sh/${process.env.NTFY_TOPIC}`, {
      method: 'POST',
      headers: { Title: alert.title, Priority: String(alert.priority), Tags: alert.tags.join(','), Click: DASHBOARD, 'user-agent': UA },
      body,
    }).then(r => log(`alert: ntfy ${r.status}`)).catch(e => log(`alert: ntfy failed: ${e.message}`)));
  }
  if (process.env.RESEND_API_KEY && process.env.ALERT_TO) {
    tasks.push(fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'content-type': 'application/json', 'user-agent': UA },
      body: JSON.stringify({ from: process.env.ALERT_FROM || 'Jarvis <jarvis@williamsdigital.io>', to: [process.env.ALERT_TO], subject: alert.title, text: `${body}\n\n${DASHBOARD}` }),
    }).then(async r => log(`alert: resend ${r.status}${r.ok ? '' : ' ' + (await r.text()).slice(0, 200)}`)).catch(e => log(`alert: resend failed: ${e.message}`)));
  }
  if (!tasks.length) log('alert: no NTFY_TOPIC or RESEND_API_KEY configured, nothing sent');
  await Promise.all(tasks);
}

// ---------- main ----------

const sites = JSON.parse(await readFile(new URL('sites.json', ROOT), 'utf8'));
await mkdir(HISTORY, { recursive: true });
const now = nowSec();
const nowMs = Date.now();
CHROME = await findChrome();
log(`render check: ${CHROME ? `using ${CHROME}` : 'no Chrome found, skipped'}`);

const prevLatest = await readJson(new URL('latest.json', DATA), null);
let domains = await readJson(new URL('domains.json', DATA), {});
domains = await refreshDomains(sites, domains, now);
await writeFile(new URL('domains.json', DATA), JSON.stringify(domains, null, 1));

const results = await mapLimit(sites, CONCURRENCY, site => probe(site, domainDaysFor(new URL(site.url).hostname, domains, nowMs)));

let daily = await readJson(new URL('daily.json', DATA), {});
const histories = {};
const spark = {};
for (const [i, site] of sites.entries()) {
  const file = new URL(`${site.slug}.json`, HISTORY);
  const history = appendSample(await readJson(file, []), results[i].sample, { now });
  histories[site.slug] = history;
  spark[site.slug] = recent(history, { now, windowSec: 24 * 3600 });
  daily = rollDaily(daily, site.slug, results[i].sample);
  await writeFile(file, JSON.stringify(history));
}
const latest = buildLatest(sites, histories, { now });

// Transitions, incidents, diagnosis, alerts.
let incidents = await readJson(new URL('incidents.json', DATA), []);
const transitions = detectTransitions(prevLatest?.sites, latest.sites);
for (const t of transitions) {
  if (t.from === 'down') { const open = openIncident(incidents, t.slug); if (open) t.downForSec = now - open.startedAt; }
}
incidents = updateIncidents(incidents, transitions, { now });
const diagnoses = [];
for (const t of transitions.filter(x => x.to === 'down')) {
  const inc = openIncident(incidents, t.slug);
  if (!inc || inc.diagnosis) continue;
  const i = sites.findIndex(s => s.slug === t.slug);
  const d = await diagnoseIncident({ site: sites[i], sample: results[i].sample, attempts: results[i].attempts, recent: spark[t.slug], paths: results[i].pathResults });
  if (d) { incidents = attachDiagnosis(incidents, inc.id, d); diagnoses.push({ name: t.name, ...d }); log(`claude: ${t.name}: ${d.summary}`); }
}
latest.incidentsOpen = incidents.filter(i => i.endedAt === null).length;

await writeFile(new URL('incidents.json', DATA), JSON.stringify(incidents, null, 1));
await writeFile(new URL('daily.json', DATA), JSON.stringify(daily));
await writeFile(new URL('spark.json', DATA), JSON.stringify(spark));
await writeFile(new URL('latest.json', DATA), JSON.stringify(latest, null, 1));

for (const r of latest.sites) {
  const flag = r.status === 'up' ? ' ' : r.status === 'degraded' ? '~' : '!';
  log(`${flag} ${r.status.padEnd(8)} ${String(r.ms).padStart(5)}ms  ${String(r.httpStatus).padStart(3)}  ssl ${String(r.sslDays).padStart(3)}d  dom ${String(r.domainDays ?? '-').padStart(4)}  text ${String(r.renderChars ?? '-').padStart(6)}  ${r.name}${r.note ? '  — ' + r.note : ''}`);
}
log(latest.headline);
if (transitions.length) log('transitions: ' + transitions.map(t => `${t.name} ${t.from}→${t.to}`).join(', '));
const alerts = transitions.filter(alertable);
if (alerts.length) await notify(formatAlert(alerts, latest), diagnoses);
