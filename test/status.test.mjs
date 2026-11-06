import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, daysUntil, pickSample, DEFAULTS } from '../lib/status.mjs';

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

test('classify: cert warning is 10 days, so a Lets Encrypt renewal window (29 days) is quiet', () => {
  assert.equal(DEFAULTS.sslWarnDays, 10);
  assert.equal(classify({ ...healthy, sslDays: 29 }), 'up');
  assert.equal(classify({ ...healthy, sslDays: 12 }), 'up');
  assert.equal(classify({ ...healthy, sslDays: 9 }), 'degraded');
});

test('classify: an already expired cert is down', () => {
  assert.equal(classify({ ...healthy, sslDays: -1 }), 'down');
});

test('classify: domain expiring inside 30 days is degraded, expired is down, unknown is ignored', () => {
  assert.equal(classify({ ...healthy, domainDays: 400 }), 'up');
  assert.equal(classify({ ...healthy, domainDays: 20 }), 'degraded');
  assert.equal(classify({ ...healthy, domainDays: -2 }), 'down');
  assert.equal(classify({ ...healthy, domainDays: null }), 'up');
});

test('classify: a 200 that renders almost no visible text is down (blank page)', () => {
  assert.equal(classify({ ...healthy, renderChars: 40 }), 'down');
  assert.equal(classify({ ...healthy, renderChars: 1200 }), 'up');
  assert.equal(classify({ ...healthy, renderChars: undefined }), 'up');
});

test('classify: a failing critical path is degraded, not down', () => {
  assert.equal(classify({ ...healthy, pathsOk: false }), 'degraded');
  assert.equal(classify({ ...healthy, pathsOk: true }), 'up');
});

test('classify: down beats degraded when both apply', () => {
  assert.equal(classify({ ...healthy, status: 500, ms: 9000, pathsOk: false }), 'down');
});

test('pickSample: the first non-down attempt wins, otherwise the last attempt', () => {
  const down1 = { s: 'down', ms: 15000, note: 'timeout' };
  const up = { s: 'up', ms: 300 };
  const down2 = { s: 'down', ms: 14000, note: 'timeout again' };
  assert.equal(pickSample([down1, up]), up);
  assert.equal(pickSample([down1, down2]), down2);
  assert.equal(pickSample([up]), up);
});

test('daysUntil: whole days between now and a cert valid_to string', () => {
  const now = Date.UTC(2026, 10, 5, 12, 0, 0);
  assert.equal(daysUntil('Dec  5 12:00:00 2026 GMT', now), 30);
  assert.equal(daysUntil('Nov  4 12:00:00 2026 GMT', now), -1);
});
