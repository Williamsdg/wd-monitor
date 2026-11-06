// Daily Lighthouse run (performance category, mobile) for every site, rolled into data/vitals.json.
// Runs from .github/workflows/vitals.yml; locally: npm i --no-save lighthouse@12 && node vitals.mjs
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseLighthouse, rollVitals } from './lib/vitals.mjs';
import { dayKey } from './lib/aggregate.mjs';

const execFile = promisify(execFileCb);
const ROOT = new URL('.', import.meta.url);
const VITALS = new URL('data/vitals.json', ROOT);
const CONCURRENCY = 2;
const only = process.argv.slice(2);

async function readJson(url, fallback) { try { return JSON.parse(await readFile(url, 'utf8')); } catch { return fallback; } }

async function lighthouse(url) {
  const dir = await mkdtemp(join(tmpdir(), 'wdlh-'));
  const out = join(dir, 'lhr.json');
  try {
    await execFile('npx', ['--no-install', 'lighthouse', url, '--output=json', `--output-path=${out}`, '--quiet', '--only-categories=performance',
      '--chrome-flags=--headless=new --no-sandbox --disable-gpu', '--max-wait-for-load=45000'], { timeout: 240_000, maxBuffer: 64 * 1024 * 1024 });
    return parseLighthouse(JSON.parse(await readFile(out, 'utf8')));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const sites = JSON.parse(await readFile(new URL('sites.json', ROOT), 'utf8')).filter(s => !only.length || only.includes(s.slug));
let vitals = await readJson(VITALS, {});
const day = dayKey(Math.floor(Date.now() / 1000));
const queue = [...sites];
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  while (queue.length) {
    const site = queue.shift();
    try {
      const entry = await lighthouse(site.url);
      if (entry.score === null) throw new Error('no performance score in report');
      vitals = rollVitals(vitals, site.slug, day, entry);
      console.log(`${String(entry.score).padStart(3)}  LCP ${String(entry.lcp).padStart(6)} ms  CLS ${entry.cls}  TBT ${String(entry.tbt).padStart(5)} ms  ${site.name}`);
    } catch (e) {
      console.log(`  --  ${site.name}: ${e.message.split('\n')[0]}`);
    }
  }
}));
await writeFile(VITALS, JSON.stringify(vitals));
console.log(`wrote data/vitals.json for ${day}`);
