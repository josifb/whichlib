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
