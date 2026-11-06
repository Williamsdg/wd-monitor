import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, daysUntil } from '../lib/status.mjs';

const healthy = { status: 200, ms: 420, sslDays: 60, expectOk: true };

test('classify: fast 200 with healthy cert is up', () => {
  assert.equal(classify(healthy), 'up');
});

test('classify: a network error is down', () => {
  assert.equal(classify({ ...healthy, status: 0, error: 'ECONNREFUSED' }), 'down');
});

test('classify: a 5xx is down', () => {
  assert.equal(classify({ ...healthy, status: 503 }), 'down');
});

test('classify: a 4xx is down', () => {
  assert.equal(classify({ ...healthy, status: 404 }), 'down');
});

test('classify: expected text missing is down even on 200', () => {
  assert.equal(classify({ ...healthy, expectOk: false }), 'down');
});

test('classify: slower than slowMs is degraded', () => {
  assert.equal(classify({ ...healthy, ms: 3500 }), 'degraded');
  assert.equal(classify({ ...healthy, ms: 1500 }, { slowMs: 1000 }), 'degraded');
});

test('classify: cert expiring inside 14 days is degraded', () => {
  assert.equal(classify({ ...healthy, sslDays: 10 }), 'degraded');
});

test('classify: an already expired cert is down', () => {
  assert.equal(classify({ ...healthy, sslDays: -1 }), 'down');
});

test('daysUntil: whole days between now and a cert valid_to string', () => {
  const now = Date.UTC(2026, 10, 5, 12, 0, 0);
  assert.equal(daysUntil('Dec  5 12:00:00 2026 GMT', now), 30);
  assert.equal(daysUntil('Nov  4 12:00:00 2026 GMT', now), -1);
});
