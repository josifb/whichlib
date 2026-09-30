import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDailyCounter, checkBurst, DAILY_LIMIT } from '../src/limits.mjs';
import { fakeD1, fakeBurst } from './helpers.mjs';

test('the daily limit is 50', () => assert.equal(DAILY_LIMIT, 50));

test('counts calls, allows 50, refuses call 51', async () => {
  const counter = createDailyCounter(fakeD1());
  let last;
  for (let i = 1; i <= 50; i++) {
    last = await counter.hit('u', '2026-10-01', '2026-09-30');
    assert.equal(last.allowed, true, `call ${i}`);
  }
  assert.equal(last.remaining, 0);
  const refused = await counter.hit('u', '2026-10-01', '2026-09-30');
  assert.equal(refused.allowed, false);
  assert.equal(refused.remaining, 0);
});

test('remaining counts down; users and days are separate', async () => {
  const counter = createDailyCounter(fakeD1(), { limit: 3 });
  assert.deepEqual(await counter.hit('u', '2026-10-01', '2026-09-30'), { allowed: true, calls: 1, remaining: 2 });
  assert.equal((await counter.hit('v', '2026-10-01', '2026-09-30')).calls, 1);
  assert.equal((await counter.hit('u', '2026-10-02', '2026-10-01')).calls, 1);
});

test('each write deletes rows older than yesterday', async () => {
  const db = fakeD1();
  db.exec("INSERT INTO daily_usage VALUES ('old', '2026-09-28', 5), ('y', '2026-09-30', 2)");
  await createDailyCounter(db).hit('u', '2026-10-01', '2026-09-30');
  assert.deepEqual(db.rows().map((r) => r.day), ['2026-09-30', '2026-10-01']);
});

test('checkBurst passes the key and returns success; no binding means allowed', async () => {
  const burst = fakeBurst(1);
  assert.equal(await checkBurst(burst, 'k'), true);
  assert.equal(await checkBurst(burst, 'k'), false);
  assert.deepEqual(burst.keys, ['k', 'k']);
  assert.equal(await checkBurst(undefined, 'k'), true);
});
