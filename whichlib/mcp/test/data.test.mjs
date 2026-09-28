import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildProvider, refreshCache, loadHistoryProvider, STARS_URL } from '../data.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'whichlib-hist-'));
const NOW = Date.parse('2026-09-28T12:00:00Z');
const file = (date, stars) => ({ date, stars });
const put = (dir, f) => writeFileSync(join(dir, `${f.date}.json`), JSON.stringify(f));
const quiet = () => {};

// Fake raw.githubusercontent.com: serves the given stars files, 404 otherwise.
function fakeFetch(files, calls = []) {
  const byUrl = new Map(files.map((f) => [`${STARS_URL}/${f.date}.json`, f]));
  return async (url) => {
    calls.push(url);
    const f = byUrl.get(url);
    return f ? { ok: true, status: 200, json: async () => f } : { ok: false, status: 404, json: async () => ({}) };
  };
}

test('buildProvider: weekly gain, latest date and span from stars files', () => {
  const p = buildProvider([file('2026-09-21', { 'a/one': 10 }), file('2026-09-28', { 'a/one': 50, 'b/two': 1 })], 'cache');
  assert.equal(p.days, 2);
  assert.equal(p.spanDays, 7);
  assert.equal(p.latestDate, '2026-09-28');
  assert.equal(p.source, 'cache');
  assert.equal(p.starsGained7d('a/one'), 40);
  assert.equal(p.starsGained7d('b/two'), null);
  assert.equal(p.starsGained7d('x/none'), null);
});

test('buildProvider: no files is the empty history', () => {
  const p = buildProvider([], 'cache');
  assert.equal(p.days, 0);
  assert.equal(p.starsGained7d('a/one'), null);
});

test('refreshCache: empty cache downloads the dates the server has, skips 404s', async () => {
  const dir = tmp();
  const calls = [];
  const r = await refreshCache({ dir, now: NOW, fetchImpl: fakeFetch([file('2026-09-28', { 'a/one': 5 }), file('2026-09-25', { 'a/one': 2 })], calls) });
  assert.equal(r.downloaded, 2);
  assert.equal(calls.length, 10); // today and the 9 days before
  assert.deepEqual(readdirSync(dir).filter((n) => n.endsWith('.json')).sort(), ['2026-09-25.json', '2026-09-28.json']);
});

test('refreshCache: only fetches dates missing locally', async () => {
  const dir = tmp();
  put(dir, file('2026-09-28', { 'a/one': 5 }));
  const calls = [];
  await refreshCache({ dir, now: NOW, fetchImpl: fakeFetch([], calls) });
  assert.equal(calls.length, 9);
  assert.ok(!calls.some((u) => u.endsWith('2026-09-28.json')));
});

test('refreshCache: a fresh timestamp means no network call', async () => {
  const dir = tmp();
  const calls = [];
  await refreshCache({ dir, now: NOW, fetchImpl: fakeFetch([], calls) });
  const again = await refreshCache({ dir, now: NOW + 3600_000, fetchImpl: fakeFetch([], calls) });
  assert.equal(calls.length, 10);
  assert.equal(again.skipped, true);
});

test('refreshCache: prunes files older than 10 days', async () => {
  const dir = tmp();
  put(dir, file('2026-09-10', { 'a/one': 1 }));
  put(dir, file('2026-09-27', { 'a/one': 2 }));
  const r = await refreshCache({ dir, now: NOW, fetchImpl: fakeFetch([]) });
  assert.equal(r.pruned, 1);
  assert.deepEqual(readdirSync(dir).filter((n) => n.endsWith('.json')), ['2026-09-27.json']);
});

test('refreshCache: a network error throws and leaves no timestamp, so the next start retries', async () => {
  const dir = tmp();
  const failing = async () => { throw new Error('offline'); };
  await assert.rejects(refreshCache({ dir, now: NOW, fetchImpl: failing }), /offline/);
  const calls = [];
  await refreshCache({ dir, now: NOW, fetchImpl: fakeFetch([], calls) });
  assert.equal(calls.length, 10);
});

test('refreshCache: a malformed file is not written', async () => {
  const dir = tmp();
  const fetchImpl = async (url) => (url.endsWith('2026-09-28.json')
    ? { ok: true, status: 200, json: async () => ({ nope: 1 }) }
    : { ok: false, status: 404 });
  await refreshCache({ dir, now: NOW, fetchImpl });
  assert.deepEqual(readdirSync(dir).filter((n) => n.endsWith('.json')), []);
});

test('loadHistoryProvider: uses the cache at once, refreshes in the background, updates in place', async () => {
  const home = tmp();
  const cacheDir = join(home, '.whichlib', 'stars');
  mkdirSync(cacheDir, { recursive: true });
  put(cacheDir, file('2026-09-21', { 'a/one': 10 }));
  const { provider, refreshed } = await loadHistoryProvider({
    env: {}, homeDir: home, repoDir: tmp(), now: NOW, log: quiet,
    fetchImpl: fakeFetch([file('2026-09-28', { 'a/one': 80 })]),
  });
  assert.equal(provider.days, 1); // before the refresh lands
  await refreshed;
  assert.equal(provider.days, 2);
  assert.equal(provider.starsGained7d('a/one'), 70);
});

test('loadHistoryProvider: WHICHLIB_HISTORY=off never fetches', async () => {
  const calls = [];
  const { provider, refreshed } = await loadHistoryProvider({
    env: { WHICHLIB_HISTORY: 'off' }, homeDir: tmp(), repoDir: tmp(), now: NOW, log: quiet, fetchImpl: fakeFetch([], calls),
  });
  await refreshed;
  assert.equal(calls.length, 0);
  assert.equal(provider.days, 0);
});

test('loadHistoryProvider: offline keeps the cached history, logs to stderr only, never throws', async () => {
  const home = tmp();
  mkdirSync(join(home, '.whichlib', 'stars'), { recursive: true });
  put(join(home, '.whichlib', 'stars'), file('2026-09-27', { 'a/one': 1 }));
  const logged = [];
  const { provider, refreshed } = await loadHistoryProvider({
    env: {}, homeDir: home, repoDir: tmp(), now: NOW, log: (m) => logged.push(m),
    fetchImpl: async () => { throw new Error('offline'); },
  });
  await refreshed;
  assert.equal(provider.days, 1);
  assert.equal(logged.length, 1);
  assert.match(logged[0], /offline/);
});

test('loadHistoryProvider: a clone with data/stars uses it and does not download', async () => {
  const repo = tmp();
  mkdirSync(join(repo, 'data', 'stars'), { recursive: true });
  put(join(repo, 'data', 'stars'), file('2026-09-28', { 'a/one': 1 }));
  const calls = [];
  const { provider, refreshed } = await loadHistoryProvider({ env: {}, homeDir: tmp(), repoDir: repo, now: NOW, log: quiet, fetchImpl: fakeFetch([], calls) });
  await refreshed;
  assert.equal(provider.source, 'clone');
  assert.equal(calls.length, 0);
});

test('loadHistoryProvider: FRESH_REPOS_DATA_DIR with trending snapshots still works', async () => {
  const dir = tmp();
  const snap = (date, stars) => ({ date, results: [{ items: [{ fullName: 'a/one', stars }] }] });
  writeFileSync(join(dir, '2026-09-21.json'), JSON.stringify(snap('2026-09-21', 10)));
  writeFileSync(join(dir, '2026-09-28.json'), JSON.stringify(snap('2026-09-28', 30)));
  const { provider } = await loadHistoryProvider({ env: { FRESH_REPOS_DATA_DIR: dir }, homeDir: tmp(), repoDir: tmp(), now: NOW, log: quiet, fetchImpl: fakeFetch([]) });
  assert.equal(provider.starsGained7d('a/one'), 20);
});

test('buildProvider: flags scaled gains as estimates', () => {
  const p = buildProvider([file('2026-09-25', { 'a/one': 10, 'b/two': 1 }), file('2026-09-28', { 'a/one': 40, 'b/two': 1 })], 'cache');
  assert.equal(p.starsGained7d('a/one'), 40); // 30 in 3 days -> 70 a week, capped at 40 stars
  assert.equal(p.starsGainedEstimated('a/one'), true);
  assert.equal(p.starsGainedEstimated('x/none'), false);
});
