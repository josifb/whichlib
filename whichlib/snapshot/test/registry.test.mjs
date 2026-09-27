import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  candidateNames, urlsMentionRepo, registriesFor,
  findNpmPackage, findPypiPackage, npmWeeklyDownloads, pypiWeeklyDownloads,
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

test('weekly downloads: npm and pypistats parsing, scoped npm names encoded, null on 404', async () => {
  const f = fakeFetch({
    'https://api.npmjs.org/downloads/point/last-week/@acme%2Fwidget': { downloads: 1234, package: '@acme/widget' },
    'https://pypistats.org/api/packages/httpx/recent': { data: { last_day: 1, last_week: 777, last_month: 9 } },
  });
  assert.equal(await npmWeeklyDownloads('@acme/widget', f), 1234);
  assert.equal(await pypiWeeklyDownloads('httpx', f), 777);
  assert.equal(await npmWeeklyDownloads('nope', f), null);
  assert.equal(await pypiWeeklyDownloads('nope', f), null);
});

test('resolvePackages: looks up, records a positive in the cache, returns packages with downloads', async () => {
  const f = fakeFetch({
    'https://registry.npmjs.org/widget': { name: 'widget', repository: { url: 'https://github.com/acme/widget' } },
    'https://api.npmjs.org/downloads/point/last-week/widget': { downloads: 500 },
  });
  const cache = {};
  const now = Date.parse('2026-09-27T00:00:00Z');
  const out = await resolvePackages({ fullName: 'acme/widget', language: 'TypeScript' }, { fetchImpl: f, cache, now });
  assert.deepEqual(out, [{ registry: 'npm', name: 'widget', weeklyDownloads: 500 }]);
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
  const f = fakeFetch({ 'https://api.npmjs.org/downloads/point/last-week/widget': { downloads: 9 } });
  const cache = { 'acme/widget': { npm: 'widget', checkedAt: '2026-01-01T00:00:00.000Z' } };
  const out = await resolvePackages({ fullName: 'acme/widget', language: 'JavaScript' }, { fetchImpl: f, cache, now: Date.now() });
  assert.deepEqual(out, [{ registry: 'npm', name: 'widget', weeklyDownloads: 9 }]);
  assert.deepEqual(f.calls, ['https://api.npmjs.org/downloads/point/last-week/widget']);
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
  assert.deepEqual(out, [{ registry: 'npm', name: 'widget', weeklyDownloads: null }]);
});
