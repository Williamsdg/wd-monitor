import { test } from 'node:test';
import assert from 'node:assert/strict';
import { updateIncidents, attachDiagnosis, openIncident } from '../lib/incidents.mjs';

test('updateIncidents: a site going down opens an incident', () => {
  const out = updateIncidents([], [{ slug: 'vardar', name: 'Vardar Transportation', from: 'up', to: 'down', note: 'HTTP 503' }], { now: 1000 });
  assert.equal(out.length, 1);
  assert.deepEqual(out[0], { id: 'vardar-1000', slug: 'vardar', name: 'Vardar Transportation', startedAt: 1000, endedAt: null, note: 'HTTP 503', diagnosis: null });
});

test('updateIncidents: recovery closes the open incident for that site only', () => {
  const start = updateIncidents([], [
    { slug: 'vardar', name: 'Vardar', from: 'up', to: 'down' },
    { slug: 'cartpath', name: 'CartPath', from: 'up', to: 'down' },
  ], { now: 1000 });
  const out = updateIncidents(start, [{ slug: 'vardar', name: 'Vardar', from: 'down', to: 'up' }], { now: 2920 });
  assert.equal(openIncident(out, 'vardar'), undefined);
  assert.equal(openIncident(out, 'cartpath').startedAt, 1000);
  const closed = out.find(i => i.slug === 'vardar');
  assert.equal(closed.endedAt, 2920);
});

test('updateIncidents: a second down transition while one is open does not duplicate it', () => {
  const a = updateIncidents([], [{ slug: 'x', name: 'X', from: 'up', to: 'down' }], { now: 1 });
  const b = updateIncidents(a, [{ slug: 'x', name: 'X', from: 'degraded', to: 'down' }], { now: 2 });
  assert.equal(b.length, 1);
});

test('updateIncidents: keeps the newest 200', () => {
  let inc = [];
  for (let i = 0; i < 205; i++) inc = updateIncidents(inc, [{ slug: 's' + i, name: 'S', from: 'up', to: 'down' }], { now: i });
  assert.equal(inc.length, 200);
  assert.equal(inc[0].startedAt, 5);
});

test('attachDiagnosis: stores the diagnosis on the matching incident without touching others', () => {
  const inc = updateIncidents([], [{ slug: 'x', name: 'X', from: 'up', to: 'down' }, { slug: 'y', name: 'Y', from: 'up', to: 'down' }], { now: 7 });
  const d = { summary: 'Origin returned 503', likelyCause: 'Deploy in progress', nextSteps: ['Check Vercel'] };
  const out = attachDiagnosis(inc, 'x-7', d);
  assert.deepEqual(out.find(i => i.slug === 'x').diagnosis, d);
  assert.equal(out.find(i => i.slug === 'y').diagnosis, null);
  assert.equal(inc.find(i => i.slug === 'x').diagnosis, null, 'input is not mutated');
});
