import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createService, HostedError, HOSTED_DEFINITIONS, REPO_FIELDS } from '../src/service.mjs';
import { createCache } from '../src/cache.mjs';
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

function setup({ getRepoError = null, searchError = null, packages = [], burstLimit = 20 } = {}) {
  const calls = { tokens: [], search: 0, getRepo: [], resolve: 0 };
  const makeGitHub = (token) => {
    calls.tokens.push(token);
    return {
      hasToken: Boolean(token),
      async searchRepos() { calls.search++; if (searchError) throw searchError; return { items: [item('a/one'), item('b/two', 500)], totalCount: 2 }; },
      async getRepo(name) { calls.getRepo.push(name); if (getRepoError) throw getRepoError; return item(name); },
    };
  };
  const resolvePackages = async () => { calls.resolve++; return packages; };
  const cacheApi = fakeCacheApi(() => NOW);
  const cache = createCache({ cacheApi, now: () => NOW });
  const burst = fakeBurst(burstLimit);
  const db = fakeD1();
  const service = createService({
    env: { GITHUB_TOKEN: 'server-token', IP_SALT: 'salt', BURST: burst },
    cache, counter: createDailyCounter(db),
    loadHistory: async () => ({ days: 0, spanDays: 0, latestDate: null, starsGained7d: () => null, starsGainedEstimated: () => false }),
    loadRising: async () => ({ date: '2026-10-01', spanDays: 3, lists: { all: [] } }),
    makeGitHub, resolvePackages, now: () => NOW,
  });
  return { service, calls, cacheApi, cache, burst, db };
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
  const { service, cacheApi } = setup();
  await service.call('recommend_repos', { need: 'http client', limit: 2 }, own);
  await service.call('compare_repos', { repos: ['a/one', 'b/two'] }, own);
  assert.ok(cacheApi.store.size > 0);
  for (const [url, { body }] of cacheApi.store) {
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
    [{ getRepoError: new Error('GitHub request failed: 404 Not Found') }, anon, 502, /Could not fetch any of the repositories/],
  ];
  for (const [opts, caller, status, message] of cases) {
    const err = await setup(opts).service.call('compare_repos', { repos: ['a/one', 'b/two'] }, caller).catch((e) => e);
    assert.ok(err instanceof HostedError, String(err));
    assert.equal(err.status, status, err.message);
    assert.match(err.message, message);
  }
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
  const { service, cacheApi } = setup();
  await service.call('compare_repos', { repos: ['a/one', 'b/two'] }, anon);
  const repoEntries = [...cacheApi.store.values()].map(({ body }) => JSON.parse(body)).filter((v) => v && v.full_name);
  assert.equal(repoEntries.length, 2);
  for (const entry of repoEntries) {
    assert.deepEqual(Object.keys(entry).filter((k) => !REPO_FIELDS.includes(k)), []);
    assert.deepEqual(entry.license, { key: 'mit' });
  }
});
