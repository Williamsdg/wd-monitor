import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectTransitions, alertable, formatAlert } from '../lib/transitions.mjs';

const prev = [
  { slug: 'vardar', name: 'Vardar Transportation', url: 'https://vardartransportation.com/', status: 'up' },
  { slug: 'cartpath', name: 'CartPath', url: 'https://cartpathclub.com/', status: 'down' },
  { slug: 'ridgepole', name: 'Ridgepole', url: 'https://ridgepole.io/', status: 'up' },
];
const next = [
  { slug: 'vardar', name: 'Vardar Transportation', url: 'https://vardartransportation.com/', status: 'down', note: 'HTTP 503', since: 100 },
  { slug: 'cartpath', name: 'CartPath', url: 'https://cartpathclub.com/', status: 'up', since: 200 },
  { slug: 'ridgepole', name: 'Ridgepole', url: 'https://ridgepole.io/', status: 'degraded', note: 'slow' },
  { slug: 'newsite', name: 'New Site', url: 'https://new.example/', status: 'up' },
];

test('detectTransitions: lists every site whose status changed, ignoring sites without a previous reading', () => {
  const t = detectTransitions(prev, next);
  assert.deepEqual(t.map(x => [x.slug, x.from, x.to]), [
    ['vardar', 'up', 'down'],
    ['cartpath', 'down', 'up'],
    ['ridgepole', 'up', 'degraded'],
  ]);
  assert.equal(t[0].name, 'Vardar Transportation');
  assert.equal(t[0].note, 'HTTP 503');
});

test('detectTransitions: an unknown previous status is not a transition', () => {
  const t = detectTransitions([{ slug: 'a', status: 'unknown' }], [{ slug: 'a', status: 'up' }]);
  assert.deepEqual(t, []);
});

test('alertable: going down and coming back up alert; degraded wobble does not', () => {
  const t = detectTransitions(prev, next);
  assert.deepEqual(t.filter(alertable).map(x => x.slug), ['vardar', 'cartpath']);
});

test('formatAlert: one site down is urgent and names the cause', () => {
  const a = formatAlert([{ slug: 'vardar', name: 'Vardar Transportation', from: 'up', to: 'down', note: 'HTTP 503' }], { headline: '1 of 16 sites is down: Vardar Transportation.' });
  assert.equal(a.title, 'Vardar Transportation is down');
  assert.match(a.body, /HTTP 503/);
  assert.match(a.body, /1 of 16/);
  assert.equal(a.priority, 5);
  assert.deepEqual(a.tags, ['rotating_light']);
});

test('formatAlert: recovery is a normal-priority all-clear with the outage length', () => {
  const a = formatAlert([{ slug: 'cartpath', name: 'CartPath', from: 'down', to: 'up', downForSec: 1920 }], { headline: 'All 16 sites are up.' });
  assert.equal(a.title, 'CartPath is back up');
  assert.match(a.body, /32 min/);
  assert.equal(a.priority, 3);
  assert.deepEqual(a.tags, ['white_check_mark']);
});

test('formatAlert: several changes at once are rolled into one message', () => {
  const a = formatAlert([
    { slug: 'a', name: 'Alpha', from: 'up', to: 'down' },
    { slug: 'b', name: 'Beta', from: 'up', to: 'down' },
    { slug: 'c', name: 'Gamma', from: 'down', to: 'up' },
  ], { headline: '2 of 16 sites are down: Alpha and Beta.' });
  assert.equal(a.title, '2 sites down, 1 recovered');
  assert.match(a.body, /Alpha/);
  assert.match(a.body, /Gamma/);
  assert.equal(a.priority, 5);
});
