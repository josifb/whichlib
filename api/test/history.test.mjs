import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHistoryLoader } from '../src/history.mjs';

const FILE = { date: '2026-10-01', days: 4, spanDays: 3, estimated: true, gains: { 'a/b': [70, 1] } };
const ok = (body) => async () => new Response(JSON.stringify(body), { status: 200 });

test('builds the history object from weekly-gains.json', async () => {
  const h = await createHistoryLoader({ fetchImpl: ok(FILE) })();
  assert.equal(h.days, 4);
  assert.equal(h.latestDate, '2026-10-01');
  assert.equal(h.starsGained7d('a/b'), 70);
  assert.equal(h.starsGainedEstimated('a/b'), true);
  assert.equal(h.starsGained7d('x/y'), null);
});

test('one download per 6 hours while warm', async () => {
  let t = 0; let calls = 0;
  const load = createHistoryLoader({ fetchImpl: async () => { calls++; return new Response(JSON.stringify(FILE)); }, now: () => t });
  await load(); t = 6 * 3600_000 - 1; await load();
  assert.equal(calls, 1);
  t = 6 * 3600_000 + 1; await load();
  assert.equal(calls, 2);
});

test('missing file: empty history, retried after 5 minutes; a later success replaces it', async () => {
  let t = 0; let fail = true; let calls = 0;
  const load = createHistoryLoader({ now: () => t, fetchImpl: async () => { calls++; return fail ? new Response('no', { status: 404 }) : new Response(JSON.stringify(FILE)); } });
  assert.equal((await load()).days, 0);
  t = 60_000; await load();
  assert.equal(calls, 1);
  fail = false; t = 5 * 60_000 + 1;
  assert.equal((await load()).days, 4);
});

test('a failed refresh keeps the last good history', async () => {
  let t = 0; let fail = false;
  const load = createHistoryLoader({ now: () => t, fetchImpl: async () => (fail ? Promise.reject(new Error('net')) : new Response(JSON.stringify(FILE))) });
  await load(); fail = true; t = 7 * 3600_000;
  assert.equal((await load()).days, 4);
});

test('concurrent first calls download once (single-flight)', async () => {
  let calls = 0;
  let resolve;
  const fetchImpl = () => new Promise((res) => { calls++; resolve = res; });
  const load = createHistoryLoader({ fetchImpl, now: () => 0 });
  const p1 = load();
  const p2 = load();
  resolve(new Response(JSON.stringify(FILE)));
  const [h1, h2] = await Promise.all([p1, p2]);
  assert.equal(calls, 1);
  assert.equal(h1.days, 4);
  assert.equal(h2.days, 4);
});

test('a malformed 200 body (empty history) counts as a failure: retried after 5 minutes', async () => {
  let t = 0; let calls = 0;
  const load = createHistoryLoader({ now: () => t, fetchImpl: async () => { calls++; return new Response(JSON.stringify({ not: 'the right shape' }), { status: 200 }); } });
  const h = await load();
  assert.equal(h.days, 0);
  t = 60_000; await load();
  assert.equal(calls, 1); // still within the retry window
  t = 5 * 60_000 + 1; await load();
  assert.equal(calls, 2);
});
