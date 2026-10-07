import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeD1 } from './helpers.mjs';
import { recordHostedCall } from '../src/events.mjs';

test('schema: events has a source column that defaults to npm', async () => {
  const db = fakeD1();
  await db.prepare('INSERT INTO events (ts, tool, install_id, version, platform, node) VALUES (?, ?, ?, ?, ?, ?)')
    .bind('2026-10-02T00:00:00Z', 'recommend_repos', '00000000-0000-4000-8000-000000000000', '0.1.3', 'linux-x64', '22').run();
  assert.deepEqual(db.events().map((e) => e.source), ['npm']);
});

test('recordHostedCall: one row with the constant hosted id, source and platform, the version and the tool', async () => {
  const db = fakeD1();
  await recordHostedCall(db, 'compare_repos', { now: () => Date.parse('2026-10-02T12:00:00Z'), version: '0.1.3' });
  assert.deepEqual(db.events(), [{ ts: '2026-10-02T12:00:00.000Z', tool: 'compare_repos', install_id: 'hosted', version: '0.1.3', platform: 'hosted', node: '', source: 'hosted', protocol_version: null }]);
});

test('recordHostedCall: stores the protocol version of the call', async () => {
  const db = fakeD1();
  await recordHostedCall(db, 'compare_repos', { protocolVersion: '2026-07-28' });
  await recordHostedCall(db, 'compare_repos', { protocolVersion: 'not-a-version' });
  assert.deepEqual(db.events().map((e) => e.protocol_version), ['2026-07-28', null]);
});

test('recordHostedCall: a failing database is logged, never thrown', async () => {
  const broken = { prepare: () => ({ bind: () => ({ run: async () => { throw new Error('D1 down'); } }) }) };
  const logged = [];
  const orig = console.error;
  console.error = (...a) => logged.push(a.join(' '));
  try {
    await recordHostedCall(broken, 'recommend_repos');
  } finally { console.error = orig; }
  assert.ok(logged.some((l) => l.includes('event write failed') && l.includes('D1 down')));
});

test('recordHostedCall: no database binding, nothing happens', async () => {
  await recordHostedCall(undefined, 'recommend_repos');
});
