import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDailyCounter, checkBurst, DAILY_LIMIT } from '../src/limits.mjs';
import { fakeD1, fakeBurst } from './helpers.mjs';
import { userHash } from '../src/identity.mjs';

test('the daily limit is 50', () => assert.equal(DAILY_LIMIT, 50));

test('counts calls, allows 50, refuses call 51', async () => {
  const counter = createDailyCounter(fakeD1());
  let last;
  for (let i = 1; i <= 50; i++) {
    last = await counter.hit('u', '2026-10-01');
    assert.equal(last.allowed, true, `call ${i}`);
  }
  assert.equal(last.remaining, 0);
  const refused = await counter.hit('u', '2026-10-01');
  assert.equal(refused.allowed, false);
  assert.equal(refused.remaining, 0);
});

test('remaining counts down; users and days are separate', async () => {
  const counter = createDailyCounter(fakeD1(), { limit: 3 });
  assert.deepEqual(await counter.hit('u', '2026-10-01'), { allowed: true, calls: 1, remaining: 2 });
  assert.equal((await counter.hit('v', '2026-10-01')).calls, 1);
  assert.equal((await counter.hit('u', '2026-10-02')).calls, 1);
});

test('the first call of the day prunes rows older than yesterday', async () => {
  const db = fakeD1();
  db.exec("INSERT INTO daily_usage VALUES ('old', '2026-09-28', 5), ('y', '2026-09-30', 2)");
  await createDailyCounter(db).hit('u', '2026-10-01');
  assert.deepEqual(db.rows().map((r) => r.day), ['2026-09-30', '2026-10-01']);
});

test('a second call the same day does not prune again', async () => {
  const db = fakeD1();
  const counter = createDailyCounter(db);
  await counter.hit('u', '2026-10-01');
  db.exec("INSERT INTO daily_usage VALUES ('old', '2026-09-28', 5)");
  await counter.hit('u', '2026-10-01');
  assert.ok(db.rows().some((r) => r.day === '2026-09-28'));
});

test('the derived yesterday is correct across a month boundary', async () => {
  const db = fakeD1();
  db.exec("INSERT INTO daily_usage VALUES ('keep', '2026-09-30', 1), ('gone', '2026-09-29', 1)");
  await createDailyCounter(db).hit('u', '2026-10-01');
  const days = db.rows().map((r) => r.day);
  assert.ok(days.includes('2026-09-30'));
  assert.ok(!days.includes('2026-09-29'));
});

test('no raw IP ends up in the stored rows', async () => {
  const db = fakeD1();
  const id = await userHash('203.0.113.7', 'salt', '2026-10-01');
  await createDailyCounter(db).hit(id, '2026-10-01');
  assert.doesNotMatch(JSON.stringify(db.rows()), /\d+\.\d+\.\d+\.\d+/);
});

test('checkBurst passes the key and returns success; no binding means allowed', async () => {
  const burst = fakeBurst(1);
  assert.equal(await checkBurst(burst, 'k'), true);
  assert.equal(await checkBurst(burst, 'k'), false);
  assert.deepEqual(burst.keys, ['k', 'k']);
  assert.equal(await checkBurst(undefined, 'k'), true);
});
