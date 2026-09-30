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

test('the schema creates an index on day for the prune scan', async () => {
  const db = fakeD1();
  const idx = await db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'daily_usage_day'").first();
  assert.ok(idx, 'expected daily_usage_day index to exist');
});

test('fakeD1.batch rolls back all statements when one fails, like real D1', async () => {
  const db = fakeD1();
  const insert = "INSERT INTO daily_usage (user_hash, day, calls) VALUES ('u', '2026-10-01', 1)";
  await assert.rejects(db.batch([db.prepare(insert), db.prepare('NOT VALID SQL')]));
  assert.deepEqual(db.rows(), []);
});
