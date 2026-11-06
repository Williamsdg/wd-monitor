// Builds last month's client site reports into data/reports/<YYYY-MM>/<slug>.html and tells Dylan they are ready.
// Reports are DRAFTS for Dylan to forward; this never emails a client. Usage: node report.mjs [YYYY-MM]
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { previousMonth, monthLabel, monthlyStats, renderReportHtml } from './lib/report.mjs';
import { dayKey } from './lib/aggregate.mjs';
import { writeNarrative } from './lib/claude.mjs';

const ROOT = new URL('.', import.meta.url);
const DATA = new URL('data/', ROOT);
const UA = 'WD-Monitor/2.0 (+https://williamsdigital.io)';
const PUBLIC = 'https://williamsdigital.io/wd-monitor/';

async function readJson(url, fallback) { try { return JSON.parse(await readFile(url, 'utf8')); } catch { return fallback; } }

const month = process.argv[2] || previousMonth();
if (!/^\d{4}-\d{2}$/.test(month)) { console.error('month must look like 2026-10'); process.exit(1); }
const label = monthLabel(month);
const sites = JSON.parse(await readFile(new URL('sites.json', ROOT), 'utf8')).filter(s => s.owner === 'client');
const daily = await readJson(new URL('daily.json', DATA), {});
const latest = await readJson(new URL('latest.json', DATA), { sites: [] });
const incidents = await readJson(new URL('incidents.json', DATA), []);
const vitals = await readJson(new URL('vitals.json', DATA), {});
const index = await readJson(new URL('reports/index.json', DATA), {});
const dir = new URL(`reports/${month}/`, DATA);
await mkdir(dir, { recursive: true });

const built = [];
for (const site of sites) {
  const stats = monthlyStats(daily[site.slug], month);
  if (!stats) { console.log(`skip ${site.name}: no data for ${month}`); continue; }
  const row = latest.sites.find(r => r.slug === site.slug) || {};
  const monthIncidents = incidents.filter(i => i.slug === site.slug && dayKey(i.startedAt).startsWith(month + '-'));
  const v = vitals[site.slug]?.history?.filter(h => h.day.startsWith(month + '-')).slice(-1)[0] || vitals[site.slug]?.latest || null;
  const narrative = await writeNarrative({ site, monthLabel: label, stats, incidents: monthIncidents, sslDays: row.sslDays, domainDays: row.domainDays, vitals: v });
  const html = renderReportHtml({ site, month, stats, incidents: monthIncidents, sslDays: row.sslDays, domainDays: row.domainDays, vitals: v, narrative });
  await writeFile(new URL(`${site.slug}.html`, dir), html);
  built.push({ slug: site.slug, name: site.name, uptime: stats.uptime, avgMs: stats.avgMs, downtimeMin: stats.downtimeMin, file: `data/reports/${month}/${site.slug}.html`, narrative: Boolean(narrative) });
  console.log(`${site.name.padEnd(24)} uptime ${stats.uptime}%  avg ${stats.avgMs} ms  downtime ${stats.downtimeMin} min${narrative ? '' : '  (template narrative)'}`);
}
index[month] = { label, builtAt: Math.floor(Date.now() / 1000), reports: built };
await writeFile(new URL('reports/index.json', DATA), JSON.stringify(index, null, 1));

if (!built.length) { console.log('nothing built'); process.exit(0); }
const summary = built.map(b => `${b.name}: ${b.uptime}% uptime, ${b.avgMs} ms`).join('\n');
if (process.env.NTFY_TOPIC) {
  await fetch(`https://ntfy.sh/${process.env.NTFY_TOPIC}`, { method: 'POST', headers: { Title: `${label} client reports are ready`, Tags: 'bar_chart', Click: `${PUBLIC}#reports`, 'user-agent': UA }, body: `${built.length} drafts to review and forward.\n${summary}` })
    .then(r => console.log(`ntfy ${r.status}`)).catch(e => console.log(`ntfy failed: ${e.message}`));
}
if (process.env.RESEND_API_KEY && process.env.REPORT_TO) {
  for (const b of built) {
    const html = await readFile(new URL(`${b.slug}.html`, dir), 'utf8');
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'content-type': 'application/json', 'user-agent': UA },
      body: JSON.stringify({ from: process.env.ALERT_FROM || 'Jarvis <jarvis@williamsdigital.io>', to: [process.env.REPORT_TO], subject: `[Draft for ${b.name}] ${label} website report`, html }),
    }).then(async r => console.log(`resend ${b.slug} ${r.status}${r.ok ? '' : ' ' + (await r.text()).slice(0, 200)}`)).catch(e => console.log(`resend failed: ${e.message}`));
  }
}
