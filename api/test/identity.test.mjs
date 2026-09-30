import { test } from 'node:test';
import assert from 'node:assert/strict';
import { utcDay, nextUtcMidnight, userHash, clientIp, sha256Hex } from '../src/identity.mjs';

const T = Date.parse('2026-10-01T23:30:00Z');

test('utcDay and nextUtcMidnight use UTC', () => {
  assert.equal(utcDay(T), '2026-10-01');
  assert.equal(nextUtcMidnight(T), Date.parse('2026-10-02T00:00:00Z'));
  assert.equal(nextUtcMidnight(Date.parse('2026-12-31T00:00:00Z')), Date.parse('2027-01-01T00:00:00Z'));
});

test('userHash: 64 hex chars, no raw IP, changes with day, IP and salt', async () => {
  const a = await userHash('203.0.113.7', 'salt', '2026-10-01');
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.ok(!a.includes('203.0.113.7'));
  assert.notEqual(a, await userHash('203.0.113.7', 'salt', '2026-10-02'));
  assert.notEqual(a, await userHash('203.0.113.8', 'salt', '2026-10-01'));
  assert.notEqual(a, await userHash('203.0.113.7', 'other', '2026-10-01'));
  assert.equal(a, await userHash('203.0.113.7', 'salt', '2026-10-01'));
});

test('sha256Hex matches a known vector', async () => {
  assert.equal(await sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('clientIp reads CF-Connecting-IP', () => {
  assert.equal(clientIp(new Request('https://x/', { headers: { 'CF-Connecting-IP': '198.51.100.1' } })), '198.51.100.1');
  assert.equal(clientIp(new Request('https://x/')), 'unknown');
});
