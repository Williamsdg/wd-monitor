// Runs one round of checks against every site in sites.json and updates data/.
// Pure logic lives in lib/; this file is the I/O shell.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { lookup } from 'node:dns/promises';
import tls from 'node:tls';
import { classify, daysUntil } from './lib/status.mjs';
import { appendSample, rollDaily, buildLatest } from './lib/aggregate.mjs';

const ROOT = new URL('.', import.meta.url);
const DATA = new URL('data/', ROOT);
const HISTORY = new URL('data/history/', DATA);
const UA = 'WD-Monitor/1.0 (+https://williamsdigital.io)';
const TIMEOUT_MS = 15_000;
const CONCURRENCY = 6;

async function readJson(url, fallback) {
  try { return JSON.parse(await readFile(url, 'utf8')); } catch { return fallback; }
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

async function probe(site) {
  const host = new URL(site.url).hostname;
  const t = Math.floor(Date.now() / 1000);
  const out = { status: 0, ms: 0, sslDays: null, expectOk: undefined, error: undefined, final: undefined };
  try {
    await lookup(host);
  } catch (e) {
    out.error = `DNS: ${e.code || e.message}`;
  }
  if (!out.error) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    const start = performance.now();
    try {
      const res = await fetch(site.url, { signal: ctl.signal, redirect: 'follow', headers: { 'user-agent': UA, accept: 'text/html,*/*' } });
      const body = await res.text();
      out.ms = Math.round(performance.now() - start);
      out.status = res.status;
      if (res.url && new URL(res.url).hostname !== host) out.final = res.url;
      if (site.expect) out.expectOk = body.includes(site.expect);
    } catch (e) {
      out.ms = Math.round(performance.now() - start);
      out.error = e.name === 'AbortError' ? `timeout after ${TIMEOUT_MS / 1000}s` : (e.cause?.code || e.message);
    } finally {
      clearTimeout(timer);
    }
    out.sslDays = await certDays(host);
  }
  const s = classify(out);
  const sample = { t, s, ms: out.ms, code: out.status, ssl: out.sslDays };
  if (out.error) sample.note = out.error;
  else if (out.expectOk === false) sample.note = `expected text "${site.expect}" not found`;
  if (out.final) sample.final = out.final;
  return sample;
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const idx = i++; results[idx] = await fn(items[idx]); }
  }));
  return results;
}

const sites = JSON.parse(await readFile(new URL('sites.json', ROOT), 'utf8'));
await mkdir(HISTORY, { recursive: true });
const now = Math.floor(Date.now() / 1000);
const samples = await mapLimit(sites, CONCURRENCY, probe);

let daily = await readJson(new URL('daily.json', DATA), {});
const histories = {};
for (const [i, site] of sites.entries()) {
  const file = new URL(`${site.slug}.json`, HISTORY);
  const history = appendSample(await readJson(file, []), samples[i], { now });
  histories[site.slug] = history;
  daily = rollDaily(daily, site.slug, samples[i]);
  await writeFile(file, JSON.stringify(history));
}
const latest = buildLatest(sites, histories, { now });
await writeFile(new URL('daily.json', DATA), JSON.stringify(daily));
await writeFile(new URL('latest.json', DATA), JSON.stringify(latest, null, 1));

for (const r of latest.sites) {
  const flag = r.status === 'up' ? ' ' : r.status === 'degraded' ? '~' : '!';
  console.log(`${flag} ${r.status.padEnd(8)} ${String(r.ms).padStart(5)}ms  ${String(r.httpStatus).padStart(3)}  ssl ${String(r.sslDays).padStart(3)}d  ${r.name}${r.note ? '  — ' + r.note : ''}`);
}
console.log(latest.headline);
