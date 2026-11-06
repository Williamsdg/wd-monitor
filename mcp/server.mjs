#!/usr/bin/env node
// MCP server so Claude Code can read the fleet's health and act through Jarvis's workflow.
// Register once:  claude mcp add --scope user wd-monitor -- node /Users/dylanwilliams/wd-monitor/mcp/server.mjs
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import * as z from 'zod/v4';
import { dayKey } from '../lib/aggregate.mjs';

const execFile = promisify(execFileCb);
const BASE = process.env.WD_MONITOR_URL || 'https://williamsdigital.io/wd-monitor/';
const LOCAL = process.env.WD_MONITOR_LOCAL === '1';
const DATA_DIR = new URL('../data/', import.meta.url);
const REPO = 'Williamsdg/wd-monitor';
const SLUGS = ['williamsdigital', 'auburn-network', 'canvas-sports', 'film-room', 'legacy-sports', 'welcomehoa', 'ridgepole', 'buy-auburn', 'simpatico',
  'sword-and-crown', 'cornerstone', 'atn-missions', 'senn-medicine', 'weaddalogo', 'vardar', 'cartpath'];

async function data(path, signal) {
  if (LOCAL) return JSON.parse(await readFile(new URL(path, DATA_DIR), 'utf8'));
  const url = `${BASE}data/${path}?t=${Date.now()}`;
  const res = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]), headers: { 'cache-control': 'no-cache' } });
  if (res.status === 404) throw new Error(`${path} is not published yet (the monitor has not written it).`);
  if (!res.ok) throw new Error(`The monitor returned HTTP ${res.status} for ${path}. Check ${BASE}`);
  return res.json();
}

const ago = tSec => {
  const m = Math.round((Date.now() / 1000 - tSec) / 60);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};
const when = tSec => new Date(tSec * 1000).toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

function createServer() {
  const server = new McpServer({ name: 'wd-monitor', version: '2.0.0' });

  server.registerTool('wd_fleet_status', {
    title: 'Fleet status',
    description: `Current health of every Williams Digital production site from the uptime monitor (checked every 15 minutes). Returns the headline, when the data was generated (say so if it is older than 30 minutes: the cron may have stalled), and one row per site with status (up / degraded / down), response time, HTTP status, days until the SSL certificate and domain registration expire, 24h and 30d uptime, and the note explaining any problem. Call this first for any question about whether sites are up, slow, or at risk. Use wd_site_history for one site over time, wd_incidents for outages and Claude's diagnoses.`,
    inputSchema: z.strictObject({ response_format: z.enum(['markdown', 'json']).default('markdown').describe("'markdown' for a readable table, 'json' for the raw latest.json") }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async ({ response_format }, ctx) => {
    const latest = await data('latest.json', ctx.mcpReq.signal);
    if (response_format === 'json') return { content: [{ type: 'text', text: JSON.stringify(latest, null, 2) }], structuredContent: latest };
    const gen = Math.floor(Date.parse(latest.generatedAt) / 1000);
    const stale = Date.now() / 1000 - gen > 1800;
    const lines = [`# ${latest.headline}`, `Checked ${ago(gen)} (${when(gen)} Central)${stale ? '. WARNING: this reading is stale; the 15-minute cron may have stalled. Run wd_recheck.' : ''}${latest.incidentsOpen ? `. ${latest.incidentsOpen} incident(s) open.` : ''}`, '',
      '| Site | Status | ms | HTTP | SSL days | Domain days | 24h | 30d | Note |', '|---|---|---|---|---|---|---|---|---|'];
    for (const s of latest.sites) lines.push(`| ${s.name} (${s.slug}) | ${s.status} | ${s.ms ?? ''} | ${s.httpStatus ?? ''} | ${s.sslDays ?? ''} | ${s.domainDays ?? ''} | ${s.uptime24h ?? ''}% | ${s.uptime30d ?? ''}% | ${s.note || ''} |`);
    return { content: [{ type: 'text', text: lines.join('\n') }] };
  });

  server.registerTool('wd_site_history', {
    title: 'Site history',
    description: 'One site over time: per-day uptime and response times from the daily roll-ups (kept forever) plus the most recent 15-minute samples (last 30 days). Use for "how has X been this week", "when did X go down", or to see whether a slowdown is new. Example: slug="legacy-sports", days=7.',
    inputSchema: z.strictObject({
      slug: z.enum(SLUGS).describe('Site slug, as listed by wd_fleet_status'),
      days: z.number().int().min(1).max(90).default(7).describe('How many days back to summarise'),
      samples: z.number().int().min(0).max(200).default(24).describe('How many of the most recent raw samples to include (0 for none)'),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async ({ slug, days, samples }, ctx) => {
    const [daily, history] = await Promise.all([data('daily.json', ctx.mcpReq.signal), data(`history/${slug}.json`, ctx.mcpReq.signal)]);
    const since = Math.floor(Date.now() / 1000) - days * 86400;
    const dayRows = Object.entries(daily[slug] || {}).filter(([k]) => k >= dayKey(since)).sort();
    const lines = [`# ${slug}: last ${days} days`, '', '| Day | Checks | Down | Uptime | Avg ms | Max ms |', '|---|---|---|---|---|---|'];
    for (const [k, d] of dayRows) lines.push(`| ${k} | ${d.n} | ${d.down} | ${((d.up / d.n) * 100).toFixed(1)}% | ${Math.round(d.msSum / d.n)} | ${d.msMax} |`);
    if (!dayRows.length) lines.push('| (no data in this window) | | | | | |');
    const changes = [];
    for (let i = 1; i < history.length; i++) if (history[i].s !== history[i - 1].s) changes.push(`${when(history[i].t)}: ${history[i - 1].s} → ${history[i].s}${history[i].note ? ` (${history[i].note})` : ''}`);
    lines.push('', `## Status changes in the raw history (${history.length} samples kept)`, ...(changes.length ? changes.slice(-20) : ['none']));
    if (samples) {
      lines.push('', `## Most recent ${Math.min(samples, history.length)} samples (Central time)`);
      for (const h of history.slice(-samples)) lines.push(`- ${when(h.t)} ${h.s} ${h.ms} ms HTTP ${h.code}${h.note ? ` — ${h.note}` : ''}`);
    }
    return { content: [{ type: 'text', text: lines.join('\n') }] };
  });

  server.registerTool('wd_incidents', {
    title: 'Incidents',
    description: "Outage log: every time a site went down, when it recovered, and Claude's diagnosis (summary, likely cause, next steps) when one was produced. Use for 'what happened to X', 'anything down overnight', or before deciding what to fix.",
    inputSchema: z.strictObject({
      open_only: z.boolean().default(false).describe('Only incidents that have not recovered yet'),
      slug: z.enum(SLUGS).optional().describe('Limit to one site'),
      limit: z.number().int().min(1).max(100).default(20).describe('Newest N incidents'),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async ({ open_only, slug, limit }, ctx) => {
    let inc = await data('incidents.json', ctx.mcpReq.signal);
    if (open_only) inc = inc.filter(i => i.endedAt === null);
    if (slug) inc = inc.filter(i => i.slug === slug);
    inc = inc.slice(-limit).reverse();
    if (!inc.length) return { content: [{ type: 'text', text: open_only ? 'No open incidents.' : 'No incidents recorded.' }] };
    const lines = [];
    for (const i of inc) {
      lines.push(`## ${i.name}: ${when(i.startedAt)} → ${i.endedAt ? when(i.endedAt) : 'ongoing'}${i.note ? ` (${i.note})` : ''}`);
      if (i.diagnosis) lines.push(`- Summary: ${i.diagnosis.summary}`, `- Likely cause: ${i.diagnosis.likelyCause}`, ...i.diagnosis.nextSteps.map(s => `- Next: ${s}`));
      else lines.push('- No diagnosis recorded (ANTHROPIC_API_KEY not set when it happened, or the call failed).');
      lines.push('');
    }
    return { content: [{ type: 'text', text: lines.join('\n') }] };
  });

  server.registerTool('wd_vitals', {
    title: 'Performance scores',
    description: 'Daily Lighthouse performance results (mobile): score 0-100, largest contentful paint, cumulative layout shift, total blocking time, with a 90-day trend per site. Use for "which sites are slow", "is X getting faster", or for client reports.',
    inputSchema: z.strictObject({ slug: z.enum(SLUGS).optional().describe('One site with its trend; omit for the latest score of every site') }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async ({ slug }, ctx) => {
    const v = await data('vitals.json', ctx.mcpReq.signal);
    if (!Object.keys(v).length) return { content: [{ type: 'text', text: 'No Lighthouse results yet: the vitals workflow has not run.' }] };
    const lines = [];
    if (slug) {
      const s = v[slug];
      if (!s) return { content: [{ type: 'text', text: `No results for ${slug} yet.` }] };
      lines.push(`# ${slug}`, '', '| Day | Score | LCP ms | CLS | TBT ms |', '|---|---|---|---|---|');
      for (const h of s.history) lines.push(`| ${h.day} | ${h.score} | ${h.lcp} | ${h.cls} | ${h.tbt} |`);
    } else {
      lines.push('| Site | Score | LCP ms | CLS | TBT ms | Day |', '|---|---|---|---|---|---|');
      for (const [k, s] of Object.entries(v).sort((a, b) => (a[1].latest?.score ?? 0) - (b[1].latest?.score ?? 0))) if (s.latest) lines.push(`| ${k} | ${s.latest.score} | ${s.latest.lcp} | ${s.latest.cls} | ${s.latest.tbt} | ${s.latest.day} |`);
    }
    return { content: [{ type: 'text', text: lines.join('\n') }] };
  });

  server.registerTool('wd_recheck', {
    title: 'Run a check now',
    description: 'Queues an immediate run of the 15-minute check workflow on GitHub (takes 1-3 minutes to land). Use after a fix, or when wd_fleet_status says the data is stale. Needs the gh CLI logged in on this machine.',
    inputSchema: z.strictObject({}),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async () => {
    await execFile('gh', ['workflow', 'run', 'check.yml', '-R', REPO], { timeout: 30_000 });
    return { content: [{ type: 'text', text: `Queued a fresh check. Call wd_fleet_status again in about two minutes, or watch https://github.com/${REPO}/actions` }] };
  });

  server.registerTool('wd_act', {
    title: 'Redeploy or open an issue',
    description: "Runs one of Jarvis's actions through the GitHub 'actions' workflow: redeploy a site (fires its deploy hook from the DEPLOY_HOOKS repo secret) or open a GitHub issue in wd-monitor as a to-do. Needs the gh CLI logged in on this machine. Confirm with the user before redeploying a client site.",
    inputSchema: z.strictObject({
      action: z.enum(['redeploy', 'issue']).describe('redeploy = fire the deploy hook for target; issue = open a GitHub issue titled target'),
      target: z.string().min(1).max(120).describe('Site slug for redeploy, or the issue title'),
      note: z.string().max(2000).default('').describe('Why, or what the user asked for'),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, async ({ action, target, note }) => {
    await execFile('gh', ['workflow', 'run', 'actions.yml', '-R', REPO, '-f', `action=${action}`, '-f', `target=${target}`, '-f', `note=${note}`], { timeout: 30_000 });
    return { content: [{ type: 'text', text: `Dispatched ${action} for "${target}". Result: https://github.com/${REPO}/actions/workflows/actions.yml` }] };
  });

  return server;
}

serveStdio(createServer);
console.error('wd-monitor MCP server running on stdio');
