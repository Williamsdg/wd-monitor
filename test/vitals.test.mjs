import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLighthouse, rollVitals } from '../lib/vitals.mjs';

const lhr = {
  categories: { performance: { score: 0.74 } },
  audits: {
    'largest-contentful-paint': { numericValue: 9804.99 },
    'cumulative-layout-shift': { numericValue: 0.000934 },
    'total-blocking-time': { numericValue: 0 },
    'first-contentful-paint': { numericValue: 1848.06 },
    'speed-index': { numericValue: 1848.06 },
  },
};

test('parseLighthouse: score as 0-100 and metrics rounded', () => {
  assert.deepEqual(parseLighthouse(lhr), { score: 74, lcp: 9805, cls: 0.001, tbt: 0, fcp: 1848, si: 1848 });
});

test('parseLighthouse: a missing category yields null score rather than throwing', () => {
  assert.equal(parseLighthouse({ audits: {} }).score, null);
});

test('rollVitals: keeps one entry per day, newest last, capped at keepDays', () => {
  let v = rollVitals({}, 'vardar', '2026-11-05', { score: 70, lcp: 9000, cls: 0.001, tbt: 0, fcp: 1800, si: 1800 });
  v = rollVitals(v, 'vardar', '2026-11-05', { score: 74, lcp: 9805, cls: 0.001, tbt: 0, fcp: 1848, si: 1848 });
  v = rollVitals(v, 'vardar', '2026-11-06', { score: 80, lcp: 5000, cls: 0, tbt: 10, fcp: 1500, si: 1600 });
  assert.equal(v.vardar.history.length, 2);
  assert.equal(v.vardar.history[0].score, 74, 'same-day run replaces the earlier one');
  assert.equal(v.vardar.latest.day, '2026-11-06');
  assert.equal(v.vardar.latest.score, 80);
  let w = {};
  for (let i = 1; i <= 95; i++) w = rollVitals(w, 'x', `2026-01-${String(i).padStart(3, '0')}`, { score: i }, { keepDays: 90 });
  assert.equal(w.x.history.length, 90);
  assert.equal(w.x.history[0].score, 6);
});
