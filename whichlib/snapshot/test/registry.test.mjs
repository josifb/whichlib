import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  candidateNames, urlsMentionRepo, registriesFor,
  findNpmPackage, findPypiPackage, npmDownloads, pypiDownloads, downloadsTrend, MIN_TREND_BASE,
  resolvePackages, NEGATIVE_TTL_MS,
} from '../src/registry.mjs';

const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, headers: { get: () => null } });

/** Fake fetch keyed by URL; unknown URLs are 404. Records calls. */
function fakeFetch(routes) {
  const calls = [];
  const fn = async (url) => {
    calls.push(url);
    const hit = routes[url];
    if (!hit) return json(404, { error: 'Not found' });
    return typeof hit === 'function' ? hit() : json(200, hit);
  };
  fn.calls = calls;
  return fn;
}

test('candidateNames: npm tries bare and scoped, pypi tries bare, all lower-case', () => {
  assert.deepEqual(candidateNames('ColinHacks/Zod'), { npm: ['zod', '@colinhacks/zod'], pypi: ['zod'] });
});

test('urlsMentionRepo: matches github.com/owner/repo with .git, trailing slash, hash, case; rejects prefix collisions', () => {
  assert.equal(urlsMentionRepo(['git+https://github.com/colinhacks/zod.git'], 'colinhacks/zod'), true);
  assert.equal(urlsMentionRepo(['https://github.com/ColinHacks/Zod/'], 'colinhacks/zod'), true);
  assert.equal(urlsMentionRepo(['https://github.com/colinhacks/zod#readme'], 'colinhacks/zod'), true);
  assert.equal(urlsMentionRepo(['https://github.com/colinhacks/zod-extra'], 'colinhacks/zod'), false);
  assert.equal(urlsMentionRepo(['https://gitlab.com/colinhacks/zod'], 'colinhacks/zod'), false);
  assert.equal(urlsMentionRepo([null, undefined, 42, 'https://github.com/colinhacks/zod'], 'colinhacks/zod'), true);
  assert.equal(urlsMentionRepo([], 'colinhacks/zod'), false);
});

test('registriesFor: JS/TS -> npm, Python/Jupyter -> pypi, others none', () => {
  assert.deepEqual(registriesFor('JavaScript'), ['npm']);
  assert.deepEqual(registriesFor('TypeScript'), ['npm']);
  assert.deepEqual(registriesFor('Python'), ['pypi']);
  assert.deepEqual(registriesFor('Jupyter Notebook'), ['pypi']);
  assert.deepEqual(registriesFor('Rust'), []);
  assert.deepEqual(registriesFor(null), []);
});

test('findNpmPackage: skips a same-named package that links elsewhere, accepts the scoped one that links back', async () => {
  const fetchImpl = fakeFetch({
    'https://registry.npmjs.org/widget': { name: 'widget', repository: { url: 'git+https://github.com/someone-else/widget.git' } },
    'https://registry.npmjs.org/@acme%2Fwidget': { name: '@acme/widget', repository: { type: 'git', url: 'https://github.com/acme/widget' } },
  });
  assert.equal(await findNpmPackage('acme/widget', fetchImpl), '@acme/widget');
  assert.deepEqual(fetchImpl.calls, ['https://registry.npmjs.org/widget', 'https://registry.npmjs.org/@acme%2Fwidget']);
});

test('findNpmPackage: accepts repository given as a string or via homepage/bugs; null when nothing links back', async () => {
  const asString = fakeFetch({ 'https://registry.npmjs.org/widget': { name: 'widget', repository: 'github:acme/widget' } });
  assert.equal(await findNpmPackage('acme/widget', asString), 'widget');
  const viaHomepage = fakeFetch({ 'https://registry.npmjs.org/widget': { name: 'widget', homepage: 'https://github.com/acme/widget#readme' } });
  assert.equal(await findNpmPackage('acme/widget', viaHomepage), 'widget');
  const none = fakeFetch({});
  assert.equal(await findNpmPackage('acme/widget', none), null);
});

test('findPypiPackage: matches through project_urls or home_page; null otherwise', async () => {
  const viaProjectUrls = fakeFetch({ 'https://pypi.org/pypi/httpx/json': { info: { name: 'httpx', home_page: null, project_urls: { Source: 'https://github.com/encode/httpx' } } } });
  assert.equal(await findPypiPackage('encode/httpx', viaProjectUrls), 'httpx');
  const viaHome = fakeFetch({ 'https://pypi.org/pypi/httpx/json': { info: { name: 'httpx', home_page: 'https://github.com/encode/httpx', project_urls: null } } });
  assert.equal(await findPypiPackage('encode/httpx', viaHome), 'httpx');
  const wrong = fakeFetch({ 'https://pypi.org/pypi/httpx/json': { info: { name: 'httpx', home_page: 'https://github.com/other/httpx', project_urls: null } } });
  assert.equal(await findPypiPackage('encode/httpx', wrong), null);
});

// 30 daily npm counts: 2 ignored, 21 baseline days at `base`, the last 7 at `recent`.
const npmRange = (base, recent) => ({
  downloads: [...Array(2).fill(999999), ...Array(21).fill(base), ...Array(7).fill(recent)].map((downloads, i) => ({ downloads, day: `d${i}` })),
});

test('downloadsTrend: recent week over baseline week, null below the minimum baseline', () => {
  assert.equal(downloadsTrend(3000, 2000), 1.5);
  assert.equal(downloadsTrend(3000, MIN_TREND_BASE - 1), null);
  assert.equal(downloadsTrend(null, 5000), null);
});

test('npmDownloads: last 7 days summed, trend against the 3 weeks before, scoped names encoded', async () => {
  const f = fakeFetch({ 'https://api.npmjs.org/downloads/range/last-month/@acme%2Fwidget': npmRange(1000, 1500) });
  assert.deepEqual(await npmDownloads('@acme/widget', f), { weekly: 10500, trend: 1.5 });
  assert.equal(await npmDownloads('nope', f), null);
});

// npm range response for an explicit day array.
const npmDays = (days) => ({ downloads: days.map((downloads, i) => ({ downloads, day: `d${i}` })) });
const NPM_URL = 'https://api.npmjs.org/downloads/range/last-month/widget';
const withZeros = (days, idx) => days.map((v, i) => (idx.includes(i) ? 0 : v));

test('npmDownloads trend: npm missing (zero) days in the baseline do not deflate it', async () => {
  const days = withZeros(Array(28).fill(1000), [1, 5, 6, 13]);
  const f = fakeFetch({ [NPM_URL]: npmDays(days) });
  assert.deepEqual(await npmDownloads('widget', f), { weekly: 7000, trend: 1 });
});

test('npmDownloads trend: a real 1.5x rise over a flat baseline reads 1.5', async () => {
  const days = [...Array(21).fill(1000), ...Array(7).fill(1500)];
  const f = fakeFetch({ [NPM_URL]: npmDays(days) });
  assert.deepEqual(await npmDownloads('widget', f), { weekly: 10500, trend: 1.5 });
});

test('npmDownloads trend: weekday/weekend pattern with a missing baseline weekday still reads 1', async () => {
  // 28 days; index % 7 in {5, 6} are weekend days (400), the rest weekdays (1000).
  const pattern = Array.from({ length: 28 }, (_, i) => (i % 7 >= 5 ? 400 : 1000));
  const days = withZeros(pattern, [2]); // a baseline weekday (3 weeks before the last window)
  const f = fakeFetch({ [NPM_URL]: npmDays(days) });
  const out = await npmDownloads('widget', f);
  assert.equal(out.trend, 1);
  assert.equal(out.weekly, 5 * 1000 + 2 * 400);
});

test('npmDownloads trend: fewer than 4 usable recent days gives null, weekly stays the raw sum', async () => {
  const days = withZeros(Array(28).fill(1000), [21, 22, 23, 24]);
  const f = fakeFetch({ [NPM_URL]: npmDays(days) });
  assert.deepEqual(await npmDownloads('widget', f), { weekly: 3000, trend: null });
});

test('npmDownloads trend: below the minimum weekly baseline gives null', async () => {
  const f = fakeFetch({ [NPM_URL]: npmDays(Array(28).fill(100)) });
  assert.deepEqual(await npmDownloads('widget', f), { weekly: 700, trend: null });
});

test('npmDownloads trend: fewer than 28 days gives null, weekly kept from 7 days on', async () => {
  const f27 = fakeFetch({ [NPM_URL]: npmDays(Array(27).fill(1000)) });
  assert.deepEqual(await npmDownloads('widget', f27), { weekly: 7000, trend: null });
  const f7 = fakeFetch({ [NPM_URL]: npmDays(Array(7).fill(1000)) });
  assert.deepEqual(await npmDownloads('widget', f7), { weekly: 7000, trend: null });
});

test('pypiDownloads: last_week, trend against the rest of the month per week', async () => {
  const f = fakeFetch({ 'https://pypistats.org/api/packages/httpx/recent': { data: { last_day: 1, last_week: 14000, last_month: 37000 } } });
  // rest of month: 23000 over 23 days = 7000 per week
  assert.deepEqual(await pypiDownloads('httpx', f), { weekly: 14000, trend: 2 });
  assert.equal(await pypiDownloads('nope', f), null);
});

test('resolvePackages: looks up, records a positive in the cache, returns packages with downloads', async () => {
  const f = fakeFetch({
    'https://registry.npmjs.org/widget': { name: 'widget', repository: { url: 'https://github.com/acme/widget' } },
    'https://api.npmjs.org/downloads/range/last-month/widget': npmRange(1000, 1000),
  });
  const cache = {};
  const now = Date.parse('2026-09-27T00:00:00Z');
  const out = await resolvePackages({ fullName: 'acme/widget', language: 'TypeScript' }, { fetchImpl: f, cache, now });
  assert.deepEqual(out, [{ registry: 'npm', name: 'widget', weeklyDownloads: 7000, downloadsTrend: 1 }]);
  assert.deepEqual(cache['acme/widget'], { npm: 'widget', checkedAt: '2026-09-27T00:00:00.000Z' });
});

test('resolvePackages: fresh negative is not re-queried; stale negative is', async () => {
  const now = Date.parse('2026-09-27T00:00:00Z');
  const fresh = fakeFetch({});
  const cacheFresh = { 'acme/widget': { npm: null, checkedAt: new Date(now - NEGATIVE_TTL_MS / 2).toISOString() } };
  assert.deepEqual(await resolvePackages({ fullName: 'acme/widget', language: 'JavaScript' }, { fetchImpl: fresh, cache: cacheFresh, now }), []);
  assert.deepEqual(fresh.calls, []);

  const stale = fakeFetch({});
  const cacheStale = { 'acme/widget': { npm: null, checkedAt: new Date(now - NEGATIVE_TTL_MS * 2).toISOString() } };
  await resolvePackages({ fullName: 'acme/widget', language: 'JavaScript' }, { fetchImpl: stale, cache: cacheStale, now });
  assert.ok(stale.calls.length > 0, 'stale negative should be re-queried');
  assert.equal(cacheStale['acme/widget'].checkedAt, new Date(now).toISOString());
});

test('resolvePackages: cached positive skips the registry lookup but still refreshes downloads', async () => {
  const f = fakeFetch({ 'https://api.npmjs.org/downloads/range/last-month/widget': npmRange(1, 1) });
  const cache = { 'acme/widget': { npm: 'widget', checkedAt: '2026-01-01T00:00:00.000Z' } };
  const out = await resolvePackages({ fullName: 'acme/widget', language: 'JavaScript' }, { fetchImpl: f, cache, now: Date.now() });
  assert.deepEqual(out, [{ registry: 'npm', name: 'widget', weeklyDownloads: 7, downloadsTrend: null }]);
  assert.deepEqual(f.calls, ['https://api.npmjs.org/downloads/range/last-month/widget']);
});

test('resolvePackages: languages outside npm/pypi make no requests and return []', async () => {
  const f = fakeFetch({});
  assert.deepEqual(await resolvePackages({ fullName: 'acme/tool', language: 'Rust' }, { fetchImpl: f, cache: {}, now: Date.now() }), []);
  assert.deepEqual(f.calls, []);
});

test('getJson: retries on 429 honouring Retry-After, then succeeds', async () => {
  const { getJson } = await import('../src/registry.mjs');
  let n = 0;
  const slept = [];
  const fetchImpl = async () => {
    n += 1;
    if (n === 1) return { ok: false, status: 429, headers: { get: (k) => (k === 'retry-after' ? '7' : null) }, json: async () => ({}) };
    return json(200, { downloads: 5 });
  };
  const out = await getJson('https://api.npmjs.org/downloads/point/last-week/x', fetchImpl, async (ms) => { slept.push(ms); });
  assert.deepEqual(out, { downloads: 5 });
  assert.deepEqual(slept, [7000]);
});

test('getJson: gives up after three retries with the status in the error', async () => {
  const { getJson } = await import('../src/registry.mjs');
  const fetchImpl = async () => ({ ok: false, status: 503, headers: { get: () => null }, json: async () => ({}) });
  const slept = [];
  await assert.rejects(getJson('https://x.test/y', fetchImpl, async (ms) => { slept.push(ms); }), /503/);
  assert.deepEqual(slept, [3000, 10000, 30000]);
});

test('resolvePackages: a failing download lookup keeps the package with null downloads', async () => {
  const f = async (url) => {
    if (url === 'https://registry.npmjs.org/widget') return json(200, { name: 'widget', repository: { url: 'https://github.com/acme/widget' } });
    return { ok: false, status: 400, headers: { get: () => null }, json: async () => ({}) };
  };
  const out = await resolvePackages({ fullName: 'acme/widget', language: 'JavaScript' }, { fetchImpl: f, cache: {}, now: Date.now() });
  assert.deepEqual(out, [{ registry: 'npm', name: 'widget', weeklyDownloads: null, downloadsTrend: null }]);
});
