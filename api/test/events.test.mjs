import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeD1 } from './helpers.mjs';

test('schema: events has a source column that defaults to npm', async () => {
  const db = fakeD1();
  await db.prepare('INSERT INTO events (ts, tool, install_id, version, platform, node) VALUES (?, ?, ?, ?, ?, ?)')
    .bind('2026-10-02T00:00:00Z', 'recommend_repos', '00000000-0000-4000-8000-000000000000', '0.1.3', 'linux-x64', '22').run();
  assert.deepEqual(db.events().map((e) => e.source), ['npm']);
});
