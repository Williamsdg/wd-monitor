import { test } from 'node:test';
import assert from 'node:assert/strict';
import { previousMonth, monthlyStats, renderReportHtml, monthLabel } from '../lib/report.mjs';

const daily = {
  '2026-10-30': { n: 96, up: 96, down: 0, msSum: 38400, msMax: 900, msMin: 200 },
  '2026-10-31': { n: 96, up: 90, down: 6, msSum: 48000, msMax: 4200, msMin: 210 },
  '2026-11-01': { n: 96, up: 96, down: 0, msSum: 28800, msMax: 700, msMin: 190 },
};

test('previousMonth: the month before now, in Central time', () => {
  assert.equal(previousMonth(Date.UTC(2026, 10, 1, 13, 0, 0)), '2026-10');
  assert.equal(previousMonth(Date.UTC(2026, 0, 1, 13, 0, 0)), '2025-12');
  assert.equal(monthLabel('2026-10'), 'October 2026');
});

test('monthlyStats: aggregates only the days inside the month', () => {
  const s = monthlyStats(daily, '2026-10');
  assert.equal(s.checks, 192);
  assert.equal(s.uptime, 96.9);
  assert.equal(s.avgMs, 450);
  assert.equal(s.maxMs, 4200);
  assert.equal(s.downChecks, 6);
  assert.equal(s.downtimeMin, 90);
  assert.equal(s.daysWithDowntime, 1);
  assert.equal(s.daysCovered, 2);
});

test('monthlyStats: no data for the month returns null', () => {
  assert.equal(monthlyStats(daily, '2026-09'), null);
});

test('renderReportHtml: table-based WD template with bgcolor attributes and the headline figures', () => {
  const html = renderReportHtml({
    site: { slug: 'vardar', name: 'Vardar Transportation', url: 'https://vardartransportation.com/' },
    month: '2026-10',
    stats: monthlyStats(daily, '2026-10'),
    incidents: [{ startedAt: 1793500000, endedAt: 1793505400, note: 'HTTP 503' }],
    sslDays: 42, domainDays: 110, vitals: { score: 74, lcp: 9805 },
    narrative: 'A quiet month with one short blip.',
  });
  assert.match(html, /bgcolor="#070710"/);
  assert.match(html, /bgcolor="#ffffff"/);
  assert.match(html, /96\.9%/);
  assert.match(html, /Vardar Transportation/);
  assert.match(html, /October 2026/);
  assert.match(html, /A quiet month/);
  assert.doesNotMatch(html, /<div[^>]*style="[^"]*background/i, 'no div backgrounds, Gmail strips them');
});
