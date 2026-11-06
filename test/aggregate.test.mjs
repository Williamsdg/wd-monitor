import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendSample, rollDaily, uptime, lastChange, buildLatest, headline, dayKey } from '../lib/aggregate.mjs';

const H = 3600;
const s = (t, status, ms = 400) => ({ t, s: status, ms, code: status === 'down' ? 503 : 200, ssl: 60 });

test('appendSample: adds the sample and drops anything older than the window', () => {
  const now = 1_000_000;
  const history = [s(now - 40 * 86400, 'up'), s(now - 10 * 86400, 'up')];
  const out = appendSample(history, s(now, 'up'), { now, maxAgeSec: 30 * 86400 });
  assert.equal(out.length, 2);
  assert.equal(out[0].t, now - 10 * 86400);
  assert.equal(out[1].t, now);
});

test('dayKey: buckets by Central time, not UTC', () => {
  // 2026-11-06 03:30 UTC is still 2026-11-05 21:30 in Birmingham
  assert.equal(dayKey(Date.UTC(2026, 10, 6, 3, 30) / 1000), '2026-11-05');
});

test('rollDaily: creates the day bucket and accumulates counts and timings', () => {
  const t = Date.UTC(2026, 10, 5, 15, 0) / 1000;
  let daily = {};
  daily = rollDaily(daily, 'wd', s(t, 'up', 300));
  daily = rollDaily(daily, 'wd', s(t + 900, 'down', 2000));
  daily = rollDaily(daily, 'wd', s(t + 1800, 'degraded', 3500));
  const d = daily.wd['2026-11-05'];
  assert.deepEqual(d, { n: 3, up: 2, down: 1, msSum: 5800, msMax: 3500, msMin: 300 });
});

test('uptime: percent of samples in the window that were not down; degraded counts as up', () => {
  const now = 100_000;
  const history = [s(now - 30 * H, 'down'), s(now - 3 * H, 'up'), s(now - 2 * H, 'degraded'), s(now - H, 'down'), s(now, 'up')];
  assert.equal(uptime(history, { now, windowSec: 24 * H }), 75);
  assert.equal(uptime([], { now, windowSec: 24 * H }), null);
});

test('lastChange: the time the current status began', () => {
  const history = [s(10, 'up'), s(20, 'up'), s(30, 'down'), s(40, 'down')];
  assert.equal(lastChange(history), 30);
  assert.equal(lastChange([s(5, 'up')]), 5);
  assert.equal(lastChange([]), null);
});

test('headline: all up', () => {
  assert.equal(headline({ total: 16, up: 16, degraded: 0, down: 0, downNames: [], degradedNames: [] }),
    'All 16 sites are up.');
});

test('headline: names what is down and what is slow', () => {
  assert.equal(headline({ total: 16, up: 13, degraded: 1, down: 2, downNames: ['Ridgepole', 'WelcomeHOA'], degradedNames: ['Legacy Sports'] }),
    '2 of 16 sites are down: Ridgepole and WelcomeHOA. 1 is degraded: Legacy Sports.');
});

test('buildLatest: per-site rows plus summary and headline', () => {
  const now = 1_000_000;
  const sites = [{ slug: 'wd', name: 'Williams Digital', url: 'https://williamsdigital.io', owner: 'own' }];
  const histories = { wd: [s(now - 900, 'up', 300), s(now, 'up', 350)] };
  const latest = buildLatest(sites, histories, { now });
  assert.equal(latest.generatedAt, new Date(now * 1000).toISOString());
  assert.deepEqual(latest.summary, { total: 1, up: 1, degraded: 0, down: 0 });
  assert.equal(latest.headline, 'All 1 sites are up.');
  const row = latest.sites[0];
  assert.equal(row.slug, 'wd');
  assert.equal(row.status, 'up');
  assert.equal(row.ms, 350);
  assert.equal(row.httpStatus, 200);
  assert.equal(row.sslDays, 60);
  assert.equal(row.uptime24h, 100);
  assert.equal(row.since, now - 900);
});

test('recent: compact [t, ms, status] tuples inside the window, oldest first', async () => {
  const { recent } = await import('../lib/aggregate.mjs');
  const now = 100_000;
  const history = [s(now - 30 * H, 'up', 100), s(now - 2 * H, 'degraded', 3200), s(now, 'up', 250)];
  assert.deepEqual(recent(history, { now, windowSec: 24 * H }), [[now - 2 * H, 3200, 'degraded'], [now, 250, 'up']]);
});
