import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeD1 } from './helpers.mjs';

test('fakeD1 runs the schema and an upsert with RETURNING', async () => {
  const db = fakeD1();
  const upsert = 'INSERT INTO daily_usage (user_hash, day, calls) VALUES (?, ?, 1) ON CONFLICT (user_hash, day) DO UPDATE SET calls = calls + 1 RETURNING calls';
  await db.prepare(upsert).bind('u', '2026-10-01').all();
  const [r] = await db.batch([db.prepare(upsert).bind('u', '2026-10-01')]);
  assert.equal(r.results[0].calls, 2);
});
