import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apexDomain, rdapUrl, parseRdapExpiry } from '../lib/domain.mjs';

test('apexDomain: strips subdomains and keeps two-level public suffixes', () => {
  assert.equal(apexDomain('www.theauburnnetwork.com'), 'theauburnnetwork.com');
  assert.equal(apexDomain('ridgepole.io'), 'ridgepole.io');
  assert.equal(apexDomain('shop.example.co.uk'), 'example.co.uk');
});

test('apexDomain: platform-owned domains are not ours to renew', () => {
  assert.equal(apexDomain('simpatico-peach.vercel.app'), null);
  assert.equal(apexDomain('williamsdg.github.io'), null);
  assert.equal(apexDomain('foo.netlify.app'), null);
});

test('rdapUrl: .io goes to Identity Digital, everything else through rdap.org', () => {
  assert.equal(rdapUrl('ridgepole.io'), 'https://rdap.identitydigital.services/rdap/domain/ridgepole.io');
  assert.equal(rdapUrl('cartpathclub.com'), 'https://rdap.org/domain/cartpathclub.com');
});

test('parseRdapExpiry: whole days until the expiration event', () => {
  const now = Date.UTC(2026, 10, 6, 12, 0, 0);
  assert.equal(parseRdapExpiry({ events: [{ eventAction: 'registration', eventDate: '2020-01-01T00:00:00Z' }, { eventAction: 'expiration', eventDate: '2027-02-24T22:11:57Z' }] }, now), 110);
  assert.equal(parseRdapExpiry({ events: [] }, now), null);
  assert.equal(parseRdapExpiry({ errorCode: 404 }, now), null);
  assert.equal(parseRdapExpiry(null, now), null);
});
