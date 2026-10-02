import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createService, HostedError, HOSTED_DEFINITIONS, REPO_FIELDS, TOOL_SUBREQUESTS, BudgetError, createBudget } from '../src/service.mjs';
import { createCache, cacheKey } from '../src/cache.mjs';
import { createDailyCounter } from '../src/limits.mjs';
import { fakeD1, fakeBurst, fakeCacheApi } from './helpers.mjs';
import { GitHubRateLimitError, GitHubAuthError } from '../../whichlib/snapshot/src/github.mjs';
import { HOSTED_LIMIT_NOTE } from '../../whichlib/mcp/definitions.mjs';

const NOW = Date.parse('2026-10-01T20:00:00Z');
const OWN = 'ghp_OWN_TOKEN_SECRET';

function item(fullName, stars = 1000) {
  return {
    full_name: fullName, html_url: `https://github.com/${fullName}`, description: `${fullName} http client`, language: 'Rust',
    stargazers_count: stars, forks_count: 10, open_issues_count: 1, license: { key: 'mit', spdx_id: 'MIT' },
    created_at: '2024-01-01T00:00:00Z', pushed_at: '2026-09-30T00:00:00Z', archived: false, topics: [],
    node_id: 'NODE', owner: { login: 'x', avatar_url: 'https://example.invalid/a.png' }, size: 123, // fields the cache must drop
  };
}

function setup({ getRepoError = null, searchError = null, packages = [], burstLimit = 20, nItems = 2, fetchesPerRepo = 0, counter = null, typesafeKey = null, jevStatus = 200 } = {}) {
  const calls = { tokens: [], search: 0, getRepo: [], resolve: 0, fetches: 0 };
  const makeGitHub = (token, fetchImpl) => {
    calls.tokens.push(token);
    return {
      hasToken: Boolean(token),
      async searchRepos() {
        calls.search++;
        await fetchImpl('https://api.github.com/search/repositories'); // the real client fetches once per search
        if (searchError) throw searchError;
        const items = nItems === 2 ? [item('a/one'), item('b/two', 500)] : Array.from({ length: nItems }, (_, i) => item(`o/r${i}`, 1000 - i));
        return { items, totalCount: items.length };
      },
      async getRepo(name) { calls.getRepo.push(name); if (getRepoError) throw getRepoError; return { ...item(name), private: name === 'acme/secret' }; },
    };
  };
  const resolvePackages = async (repo, opts) => {
    calls.resolve++;
    for (let i = 0; i < fetchesPerRepo; i++) await opts.fetchImpl('https://registry.npmjs.org/x');
    return packages;
  };
  const fetchImpl = async (url, init) => {
    calls.fetches++;
    if (String(url).startsWith('https://api.typesafe.ai/')) {
      calls.jev = (calls.jev ?? 0) + 1;
      const body = JSON.parse(init.body);
      const answers = Object.fromEntries(Object.keys(body.questions).map((k) => [k, { type: 'noul', noul: 0.9 }]));
      return { ok: jevStatus === 200, status: jevStatus, headers: { get: () => null }, json: async () => ({ answers }) };
    }
    return {};
  };
  const cacheApi = fakeCacheApi(() => NOW);
  const cache = createCache({ cacheApi, now: () => NOW });
  const itemCache = createCache({ cacheApi: null, now: () => NOW });
  const burst = fakeBurst(burstLimit);
  const db = fakeD1();
  const service = createService({
    env: { GITHUB_TOKEN: 'server-token', IP_SALT: 'salt', BURST: burst, ...(typesafeKey ? { TYPESAFE_API_KEY: typesafeKey } : {}) },
    cache, itemCache, counter: counter ?? createDailyCounter(db), fetchImpl,
    loadHistory: async () => ({ days: 0, spanDays: 0, latestDate: null, starsGained7d: () => null, starsGainedEstimated: () => false }),
    loadRising: async () => ({ date: '2026-10-01', spanDays: 3, lists: { all: [] } }),
    makeGitHub, resolvePackages, now: () => NOW,
  });
  return { service, calls, cacheApi, cache, itemCache, burst, db };
}
const anon = { ip: '203.0.113.7', ownToken: null };
const own = { ip: '203.0.113.7', ownToken: OWN };

test('hosted definitions carry the hosted note on all three tools', () => {
  assert.equal(HOSTED_DEFINITIONS.length, 3);
  for (const d of HOSTED_DEFINITIONS) assert.ok(d.config.description.includes(HOSTED_LIMIT_NOTE), d.name);
});

test('anonymous call: server token, counted, quota returned', async () => {
  const { service, calls, db } = setup();
  const { result, quota } = await service.call('compare_repos', { repos: ['a/one', 'b/two'] }, anon);
  assert.equal(result.tool, 'compare_repos');
  assert.deepEqual(calls.tokens, ['server-token']);
  assert.deepEqual(quota, { limit: 50, remaining: 49, resetAt: Date.parse('2026-10-02T00:00:00Z') });
  assert.equal(db.rows()[0].calls, 1);
  assert.ok(result.dataNotes.includes(HOSTED_LIMIT_NOTE));
});

test('call 51 is refused with the daily-limit message and headers', async () => {
  const { service } = setup({ burstLimit: Infinity }); // the burst guard (20/min) would refuse call 21 first
  for (let i = 0; i < 50; i++) await service.call('compare_repos', { repos: ['a/one', 'b/two'] }, anon);
  const err = await service.call('compare_repos', { repos: ['a/one', 'b/two'] }, anon).catch((e) => e);
  assert.ok(err instanceof HostedError);
  assert.equal(err.status, 429);
  assert.equal(err.message, 'Daily free limit reached (50). It resets in 4 h. For unlimited use add your own GitHub token (header X-GitHub-Token) or run the npm package locally: npx -y whichlib');
  assert.equal(err.quota.remaining, 0);
});

test('own token: used for GitHub, not counted, no quota; burst guard still applies', async () => {
  const { service, calls, db, burst } = setup();
  const { quota } = await service.call('compare_repos', { repos: ['a/one', 'b/two'] }, own);
  assert.equal(quota, null);
  assert.deepEqual(calls.tokens, [OWN]);
  assert.equal(db.rows().length, 0);
  assert.equal(burst.keys.length, 1);
});

test('burst: call 21 in a minute is refused with 429', async () => {
  const { service } = setup();
  for (let i = 0; i < 20; i++) await service.call('compare_repos', { repos: ['a/one', 'b/two'] }, own);
  const err = await service.call('compare_repos', { repos: ['a/one', 'b/two'] }, own).catch((e) => e);
  assert.equal(err.status, 429);
  assert.match(err.message, /20 calls per minute/);
});

test('the token never reaches cache keys or cached values', async () => {
  const { service, cacheApi, itemCache } = setup();
  await service.call('recommend_repos', { need: 'http client', limit: 2 }, anon);
  await service.call('compare_repos', { repos: ['a/one', 'b/two'] }, anon);
  await service.call('recommend_repos', { need: 'other thing', limit: 2 }, own);
  await service.call('compare_repos', { repos: ['a/one', 'c/three'] }, own);
  assert.ok(cacheApi.store.size > 0);
  const bodies = [...cacheApi.store].map(([url, { body }]) => [url, body]);
  for (const name of ['a/one', 'b/two']) bodies.push(['', JSON.stringify(await itemCache.get(await cacheKey({ item: 'repo', name })))]);
  for (const [url, body] of bodies) {
    assert.ok(!url.includes(OWN) && !body.includes(OWN));
    assert.ok(!body.includes('server-token'));
  }
});

test('recommend: whole result cached (no second search) but every call counts', async () => {
  const { service, calls, db } = setup();
  await service.call('recommend_repos', { need: 'http client', limit: 2 }, anon);
  const searches = calls.search;
  await service.call('recommend_repos', { need: 'http client', limit: 2 }, anon);
  assert.equal(calls.search, searches);
  assert.equal(db.rows()[0].calls, 2);
});

test('compare: per-repo cache is reused across different comparisons', async () => {
  const { service, calls } = setup();
  await service.call('compare_repos', { repos: ['a/one', 'b/two'] }, anon);
  await service.call('compare_repos', { repos: ['a/one', 'c/three'] }, anon);
  // cacheKey (crypto.subtle) may finish the first two in either order
  assert.deepEqual([...calls.getRepo].sort(), ['a/one', 'b/two', 'c/three']);
});

test('a result with a failed download lookup is cached for 1 h only', async () => {
  const { service, cacheApi } = setup({ packages: [{ registry: 'npm', name: 'one', weeklyDownloads: null }] });
  await service.call('trending_repos', { period: 'week', limit: 2, withDownloads: true }, anon);
  const ttls = [...cacheApi.store.values()].map(({ headers }) => headers.get('Cache-Control'));
  assert.ok(ttls.includes('max-age=3600'));
  assert.ok(!ttls.includes('max-age=21600') && !ttls.includes('max-age=86400'), ttls.join());
});

test('errors map to statuses', async () => {
  const cases = [
    [{ getRepoError: new GitHubAuthError('GitHub request failed: 401 Bad credentials') }, own, 401, /Your GitHub token was rejected/],
    [{ getRepoError: new GitHubAuthError('GitHub request failed: 401 Bad credentials') }, anon, 502, /could not authenticate with GitHub/],
    [{ getRepoError: new GitHubRateLimitError('GitHub rate limit reached; it resets in about 2 minutes.', 90) }, anon, 503, /whichlib is busy, try again in 90 seconds, or use your own GitHub token/],
    [{ getRepoError: new GitHubRateLimitError('GitHub rate limit reached; it resets in about 2 minutes.', 90) }, own, 429, /Your GitHub token's rate limit/],
    [{ getRepoError: new Error('GitHub request failed: 404 Not Found') }, anon, 404, /Could not fetch any of the repositories/],
  ];
  for (const [opts, caller, status, message] of cases) {
    const err = await setup(opts).service.call('compare_repos', { repos: ['a/one', 'b/two'] }, caller).catch((e) => e);
    assert.ok(err instanceof HostedError, String(err));
    assert.equal(err.status, status, err.message);
    assert.match(err.message, message);
  }
  const odd = await setup({ searchError: new Error('socket hang up') }).service.call('trending_repos', { period: 'day', limit: 2, withDownloads: false }, anon).catch((e) => e);
  assert.deepEqual([odd.status, odd.message], [502, 'Upstream request failed.']);
  const busy = await setup({ searchError: new GitHubRateLimitError('x', 90) }).service.call('trending_repos', { period: 'day', limit: 2, withDownloads: false }, anon).catch((e) => e);
  assert.equal(busy.headers['Retry-After'], '90');
  const bad = await setup().service.call('compare_repos', { repos: ['not a name', 'a/one'] }, anon).catch((e) => e);
  assert.equal(bad.status, 400);
});

test('unknown tool name is a 400', async () => {
  const err = await setup().service.call('nope', {}, anon).catch((e) => e);
  assert.equal(err.status, 400);
});

test('cached repo entries are slimmed to the fields normalizeRepo reads', async () => {
  const { service, itemCache } = setup();
  await service.call('compare_repos', { repos: ['a/one', 'b/two'] }, anon);
  for (const name of ['a/one', 'b/two']) {
    const entry = await itemCache.get(await cacheKey({ item: 'repo', name }));
    assert.ok(entry && entry.full_name === name);
    assert.deepEqual(Object.keys(entry).filter((k) => !REPO_FIELDS.includes(k)), []);
    assert.deepEqual(entry.license, { key: 'mit' });
  }
});

test('own token: may read the caches but never writes to them (private repos must not leak)', async () => {
  const { service, calls, cacheApi, itemCache } = setup();
  await service.call('compare_repos', { repos: ['acme/secret', 'a/one'] }, own);
  await service.call('recommend_repos', { need: 'http client', limit: 2 }, own);
  assert.equal(cacheApi.store.size, 0);
  assert.equal(await itemCache.get(await cacheKey({ item: 'repo', name: 'acme/secret' })), undefined);
  await service.call('compare_repos', { repos: ['acme/secret', 'a/one'] }, anon);
  assert.equal(calls.getRepo.filter((n) => n === 'acme/secret').length, 2); // fetched again, not served from cache
  // reads still work: the anon call cached a/one, so an own-token call reuses it
  const before = calls.getRepo.length;
  await service.call('compare_repos', { repos: ['a/one', 'b/two'] }, own);
  assert.deepEqual(calls.getRepo.slice(before), ['b/two']);
});

test('subrequest budget: a big recommend stays within TOOL_SUBREQUESTS, is noted, and cached for 1 h', async () => {
  assert.equal(TOOL_SUBREQUESTS, 35);
  const { service, calls, cacheApi } = setup({ nItems: 15, fetchesPerRepo: 5 });
  const { result } = await service.call('recommend_repos', { need: 'http client', limit: 10 }, anon);
  assert.ok(calls.fetches > 0 && calls.fetches <= TOOL_SUBREQUESTS, String(calls.fetches));
  assert.ok(result.dataNotes.includes('Download counts were skipped for some repositories to stay within the hosted request limit; run the npm package locally for full data.'));
  const ttls = [...cacheApi.store.values()].map(({ headers }) => headers.get('Cache-Control'));
  assert.deepEqual(ttls, ['max-age=3600']);
});

test('over the daily limit: refused without further D1 writes', async () => {
  const { service, db } = setup({ burstLimit: Infinity });
  for (let i = 0; i < 52; i++) await service.call('compare_repos', { repos: ['a/one', 'b/two'] }, anon).catch(() => {});
  const calls = db.rows()[0].calls;
  await service.call('compare_repos', { repos: ['a/one', 'b/two'] }, anon).catch(() => {});
  assert.equal(db.rows()[0].calls, calls);
});

test('only whichlib-side failures refund the daily count', async () => {
  const count = async (opts) => {
    const t = setup(opts);
    const err = await t.service.call('compare_repos', { repos: ['a/one', 'b/two'] }, anon).catch((e) => e);
    return [err.status, t.db.rows()[0].calls];
  };
  assert.deepEqual(await count({ getRepoError: new GitHubRateLimitError('x', 90) }), [503, 0]); // shared limit: refunded
  assert.deepEqual(await count({ getRepoError: new GitHubAuthError('401 Bad credentials') }), [502, 0]); // server token rejected: refunded
  assert.deepEqual(await count({ getRepoError: new Error('GitHub request failed: 404 Not Found') }), [404, 1]); // missing repos: counted
  const other = setup({ searchError: new Error('socket hang up') });
  const err = await other.service.call('trending_repos', { period: 'day', limit: 2, withDownloads: false }, anon).catch((e) => e);
  assert.deepEqual([err.status, other.db.rows()[0].calls], [502, 1]); // unknown cause: counted
  const invalid = setup();
  await invalid.service.call('compare_repos', { repos: ['not a name', 'a/one'] }, anon).catch(() => {});
  assert.equal(invalid.db.rows()[0].calls, 1);
});

test('a caller that joins a budget-starved lookup is also marked degraded', async () => {
  const cacheApi = fakeCacheApi(() => NOW);
  const gate = () => new Promise((r) => setTimeout(r, 5));
  const cache = createCache({ cacheApi, now: () => NOW });
  const itemCache = createCache({ cacheApi: null, now: () => NOW });
  let resolves = 0;
  const svc = createService({
    env: { GITHUB_TOKEN: 'server-token', IP_SALT: 'salt' }, cache, itemCache, counter: createDailyCounter(fakeD1()),
    loadHistory: async () => ({ days: 0, spanDays: 0, latestDate: null, starsGained7d: () => null, starsGainedEstimated: () => false }),
    loadRising: async () => ({ date: '2026-10-01', spanDays: 3, lists: { all: [] } }),
    makeGitHub: () => ({ hasToken: true, async searchRepos() { return { items: [item('a/one')], totalCount: 1 }; } }),
    resolvePackages: async () => { resolves++; await gate(); throw new BudgetError(); },
    fetchImpl: async () => ({}), now: () => NOW,
  });
  const [x, y] = await Promise.all([
    svc.call('recommend_repos', { need: 'http client', limit: 2 }, anon),
    svc.call('recommend_repos', { need: 'http client two', limit: 2 }, { ...anon, ip: '203.0.113.8' }),
  ]);
  assert.equal(resolves, 1); // the second call joined the first one's lookup
  for (const { result } of [x, y]) assert.ok(result.dataNotes.some((n) => n.startsWith('Download counts were skipped')));
});

test('limit infrastructure failures become a 503 and are logged', async () => {
  const logged = [];
  const orig = console.error;
  console.error = (...a) => logged.push(a.join(' '));
  try {
    const counter = { limit: 50, async hit() { throw new Error('D1 down'); } };
    const err = await setup({ counter }).service.call('compare_repos', { repos: ['a/one', 'b/two'] }, anon).catch((e) => e);
    assert.ok(err instanceof HostedError);
    assert.equal(err.status, 503);
    assert.match(err.message, /temporarily unavailable/);
    assert.ok(logged.some((l) => l.includes('D1 down')));
  } finally { console.error = orig; }
});

test('whole-result cache keys ignore language case and need whitespace', async () => {
  const { service, calls } = setup();
  await service.call('recommend_repos', { need: 'http client', language: 'Python', limit: 2 }, anon);
  const searches = calls.search;
  await service.call('recommend_repos', { need: ' http  client ', language: 'python', limit: 2 }, anon);
  assert.equal(calls.search, searches);
});

test('budget fetch: registry 429/5xx throws at once, GitHub responses pass through', async () => {
  const responses = { 'https://pypistats.org/x': 429, 'https://registry.npmjs.org/y': 503, 'https://api.github.com/z': 429, 'https://pypi.org/ok': 200 };
  const budget = createBudget(async (url) => new Response('{}', { status: responses[url] }), 10);
  await assert.rejects(budget.fetch('https://pypistats.org/x'), /registry busy: pypistats\.org 429/);
  await assert.rejects(budget.fetch('https://registry.npmjs.org/y'), /registry busy: registry\.npmjs\.org 503/);
  assert.equal((await budget.fetch('https://api.github.com/z')).status, 429);
  assert.equal((await budget.fetch('https://pypi.org/ok')).status, 200);
  assert.equal(budget.busy, true);
});

test('real resolvePackages with pypistats answering 429: no waiting, downloads null', async () => {
  const started = Date.now();
  const json = (body) => new Response(JSON.stringify(body), { status: 200 });
  const fetchImpl = async (url) => {
    if (url.startsWith('https://pypistats.org/')) return new Response('slow down', { status: 429 });
    const m = /^https:\/\/pypi\.org\/pypi\/([^/]+)\/json$/.exec(url);
    if (m && ['httpx', 'requests'].includes(m[1])) return json({ info: { name: m[1], project_urls: { Source: `https://github.com/${m[1] === 'httpx' ? 'encode' : 'psf'}/${m[1]}` } } });
    return new Response('', { status: 404 });
  };
  const cacheApi = fakeCacheApi(() => NOW);
  const svc = createService({
    env: { GITHUB_TOKEN: 'server-token', IP_SALT: 'salt' },
    cache: createCache({ cacheApi, now: () => NOW }), itemCache: createCache({ cacheApi: null, now: () => NOW }),
    counter: createDailyCounter(fakeD1()),
    loadHistory: async () => ({ days: 0, spanDays: 0, latestDate: null, starsGained7d: () => null, starsGainedEstimated: () => false }),
    loadRising: async () => ({ date: '2026-10-01', spanDays: 3, lists: { all: [] } }),
    makeGitHub: () => ({ hasToken: true, async getRepo(name) { return { ...item(name), language: 'Python' }; } }),
    fetchImpl, now: () => NOW,
  });
  const { result } = await svc.call('compare_repos', { repos: ['encode/httpx', 'psf/requests'] }, anon);
  assert.ok(Date.now() - started < 1000, `took ${Date.now() - started} ms`);
  const pkgs = result.repos.flatMap((r) => r.packages ?? []);
  assert.ok(pkgs.length >= 1);
  for (const p of pkgs) assert.equal(p.weeklyDownloads, null);
});

test('jev: with TYPESAFE_API_KEY, recommend is judged through the budget fetch', async () => {
  const { service, calls } = setup({ typesafeKey: 'ts-key' });
  const { result } = await service.call('recommend_repos', { need: 'http client', limit: 2 }, anon);
  assert.equal(result.fitJudge, 'jev-1.13.0');
  assert.equal(calls.jev, 1);
  assert.equal(result.repos[0].signals.jevFit, 0.9);
});

test('jev: without the key nothing changes', async () => {
  const { service, calls } = setup();
  const { result } = await service.call('recommend_repos', { need: 'http client', limit: 2 }, anon);
  assert.equal(result.fitJudge, 'rules');
  assert.equal(calls.jev, undefined);
});

test('jev: TypeSafe overloaded -> rules ranking, noted, cached for 1 h only', async () => {
  const { service, cacheApi } = setup({ typesafeKey: 'ts-key', jevStatus: 529 });
  const { result } = await service.call('recommend_repos', { need: 'http client', limit: 2 }, anon);
  assert.equal(result.fitJudge, 'rules (judge unavailable)');
  assert.ok(result.dataNotes.some((n) => n.startsWith('The fit judgment (TypeSafe Jev) was unavailable')));
  const ttls = [...cacheApi.store.values()].map(({ headers }) => headers.get('Cache-Control'));
  assert.ok(ttls.includes('max-age=3600'), ttls.join());
  assert.ok(!ttls.includes('max-age=86400'), ttls.join());
});

test('jev: compare and trending never call TypeSafe', async () => {
  const { service, calls } = setup({ typesafeKey: 'ts-key' });
  await service.call('compare_repos', { repos: ['a/one', 'b/two'] }, anon);
  await service.call('trending_repos', { period: 'week' }, anon);
  assert.equal(calls.jev, undefined);
});

test('jev: the recommend cache key depends on the judge (old rules results are not served)', async () => {
  const { service: plain, cacheApi } = setup();
  await plain.call('recommend_repos', { need: 'http client', limit: 2 }, anon);
  const plainKeys = [...cacheApi.store.keys()].filter((k) => !String(k).includes('item'));
  const { service: judged, cacheApi: judgedCache } = setup({ typesafeKey: 'ts-key' });
  await judged.call('recommend_repos', { need: 'http client', limit: 2 }, anon);
  const judgedKeys = [...judgedCache.store.keys()];
  assert.ok(plainKeys.length >= 1);
  assert.ok(!plainKeys.some((k) => judgedKeys.includes(k)), 'a recommend key is shared');
});

test('jev: own-token callers are never judged (private repos stay away from TypeSafe)', async () => {
  const { service, calls } = setup({ typesafeKey: 'ts-key' });
  const { result } = await service.call('recommend_repos', { need: 'http client', limit: 2 }, own);
  assert.equal(result.fitJudge, 'rules');
  assert.equal(calls.jev, undefined);
});

test('jev: TypeSafe 401 -> fallback cached for 1 h, logged without the key', async () => {
  const { service, cacheApi } = setup({ typesafeKey: 'ts-key', jevStatus: 401 });
  const logged = [];
  const orig = console.error;
  console.error = (...a) => { logged.push(a); };
  try {
    const { result } = await service.call('recommend_repos', { need: 'http client', limit: 2 }, anon);
    assert.equal(result.fitJudge, 'rules (judge unavailable)');
  } finally { console.error = orig; }
  const ttls = [...cacheApi.store.values()].map(({ headers }) => headers.get('Cache-Control'));
  assert.ok(ttls.includes('max-age=3600'), ttls.join());
  assert.ok(!ttls.includes('max-age=86400'), ttls.join());
  assert.ok(logged.some((a) => a[0] === 'jev failed'), JSON.stringify(logged));
  assert.ok(!JSON.stringify(logged).includes('ts-key'));
});
