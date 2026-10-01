import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchSearch, fetchGitHub, paceDelayMs, GitHubRateLimitError, GitHubAuthError } from '../src/github.mjs';

function response(status, body, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k) => headers[k.toLowerCase()] ?? null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

test('fetchSearch: returns items and totalCount, sends auth header when token given', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return response(200, { total_count: 2, items: [{ id: 1 }, { id: 2 }] });
  };
  const out = await fetchSearch('https://api.github.com/x', { token: 'abc', fetchImpl, sleep: async () => {} });
  assert.deepEqual(out, { items: [{ id: 1 }, { id: 2 }], totalCount: 2 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.headers.Authorization, 'Bearer abc');
  assert.equal(calls[0].init.headers.Accept, 'application/vnd.github+json');
  assert.ok(calls[0].init.headers['User-Agent']);
});

test('fetchSearch: no Authorization header without a token', async () => {
  let seen;
  const fetchImpl = async (_url, init) => { seen = init; return response(200, { total_count: 0, items: [] }); };
  await fetchSearch('https://api.github.com/x', { fetchImpl, sleep: async () => {} });
  assert.equal('Authorization' in seen.headers, false);
});

test('fetchSearch: on rate limit, waits until reset and retries once', async () => {
  const resetAt = Math.floor(Date.now() / 1000) + 5;
  let n = 0;
  const slept = [];
  const fetchImpl = async () => {
    n += 1;
    if (n === 1) return response(403, { message: 'rate limited' }, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(resetAt) });
    return response(200, { total_count: 1, items: [{ id: 9 }] });
  };
  const out = await fetchSearch('https://api.github.com/x', { fetchImpl, sleep: async (ms) => { slept.push(ms); } });
  assert.equal(n, 2);
  assert.equal(out.items[0].id, 9);
  assert.equal(slept.length, 1);
  assert.ok(slept[0] > 0 && slept[0] <= 7000, `slept ${slept[0]}ms`);
});

test('fetchSearch: with maxWaitMs, a longer reset fails fast with an actionable message', async () => {
  const resetAt = Math.floor(Date.now() / 1000) + 30 * 60;
  let n = 0;
  const slept = [];
  const fetchImpl = async () => {
    n += 1;
    return response(403, { message: 'rate limited' }, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(resetAt) });
  };
  await assert.rejects(
    fetchSearch('https://api.github.com/x', { fetchImpl, maxWaitMs: 15_000, sleep: async (ms) => { slept.push(ms); } }),
    /rate limit.*resets in about 31 minutes.*GITHUB_TOKEN/i
  );
  assert.equal(n, 1);
  assert.deepEqual(slept, []);
});

test('fetchSearch: with maxWaitMs, a short reset still waits and retries', async () => {
  const resetAt = Math.floor(Date.now() / 1000) + 5;
  let n = 0;
  const fetchImpl = async () => {
    n += 1;
    if (n === 1) return response(429, {}, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(resetAt) });
    return response(200, { total_count: 0, items: [] });
  };
  await fetchSearch('https://api.github.com/x', { fetchImpl, maxWaitMs: 15_000, sleep: async () => {} });
  assert.equal(n, 2);
});

test('fetchSearch: non-rate-limit error throws with status and message', async () => {
  const fetchImpl = async () => response(422, { message: 'Validation Failed' });
  await assert.rejects(
    fetchSearch('https://api.github.com/x', { fetchImpl, sleep: async () => {} }),
    /422.*Validation Failed/
  );
});

test('paceDelayMs: slower without a token', () => {
  assert.equal(paceDelayMs(false), 6500);
  assert.equal(paceDelayMs(true), 2100);
});

test('fetchGitHub: rate limit beyond maxWaitMs throws GitHubRateLimitError with resetSeconds, same message', async () => {
  const resetAt = Math.floor(Date.now() / 1000) + 600;
  const fetchImpl = async () => response(403, { message: 'API rate limit exceeded' }, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(resetAt) });
  const err = await fetchGitHub('https://api.github.com/x', { fetchImpl, sleep: async () => {}, maxWaitMs: 0 }).catch((e) => e);
  assert.ok(err instanceof GitHubRateLimitError);
  assert.ok(err.resetSeconds >= 599 && err.resetSeconds <= 602);
  // wait = 600 s + 1 s margin, rounded up to whole minutes (same rule as the existing 31-minute test)
  assert.match(err.message, /rate limit reached; it resets in about 11 minutes/);
});

test('fetchGitHub: secondary rate limit (retry-after) is a GitHubRateLimitError too', async () => {
  const fetchImpl = async () => response(403, { message: 'You have exceeded a secondary rate limit' }, { 'retry-after': '30' });
  const err = await fetchGitHub('https://api.github.com/x', { fetchImpl, sleep: async () => {}, maxWaitMs: 0 }).catch((e) => e);
  assert.ok(err instanceof GitHubRateLimitError);
  assert.equal(err.resetSeconds, 31);
});

test('fetchGitHub: still limited after the one retry is a GitHubRateLimitError', async () => {
  const resetAt = Math.floor(Date.now() / 1000) + 2;
  const fetchImpl = async () => response(429, { message: 'limit' }, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(resetAt) });
  const err = await fetchGitHub('https://api.github.com/x', { fetchImpl, sleep: async () => {}, maxWaitMs: 60_000 }).catch((e) => e);
  assert.ok(err instanceof GitHubRateLimitError);
});

test('fetchGitHub: 401 throws GitHubAuthError with the usual message', async () => {
  const fetchImpl = async () => response(401, { message: 'Bad credentials' });
  const err = await fetchGitHub('https://api.github.com/x', { token: 'bad', fetchImpl, sleep: async () => {} }).catch((e) => e);
  assert.ok(err instanceof GitHubAuthError);
  assert.equal(err.message, 'GitHub request failed: 401 Bad credentials');
});

test('fetchGitHub: retry-after: 0 is treated as 60 seconds, not the hourly reset', async () => {
  const resetAt = Math.floor(Date.now() / 1000) + 3000;
  const fetchImpl = async () => response(403, { message: 'secondary' }, { 'retry-after': '0', 'x-ratelimit-reset': String(resetAt) });
  const err = await fetchGitHub('https://api.github.com/x', { fetchImpl, sleep: async () => {}, maxWaitMs: 0 }).catch((e) => e);
  assert.ok(err instanceof GitHubRateLimitError);
  assert.equal(err.resetSeconds, 60);
  const fetchImpl00 = async () => response(403, { message: 'secondary' }, { 'retry-after': '00', 'x-ratelimit-reset': String(resetAt) });
  const err00 = await fetchGitHub('https://api.github.com/x', { fetchImpl: fetchImpl00, sleep: async () => {}, maxWaitMs: 0 }).catch((e) => e);
  assert.ok(err00 instanceof GitHubRateLimitError);
  assert.equal(err00.resetSeconds, 60);
});

test('fetchGitHub: the GITHUB_TOKEN hint is only added to primary-limit errors', async () => {
  const secondary = async () => response(403, { message: 'secondary' }, { 'retry-after': '120' });
  const err = await fetchGitHub('https://api.github.com/x', { fetchImpl: secondary, sleep: async () => {}, maxWaitMs: 0 }).catch((e) => e);
  assert.ok(err instanceof GitHubRateLimitError);
  assert.doesNotMatch(err.message, /GITHUB_TOKEN/);
  const resetAt = Math.floor(Date.now() / 1000) + 600;
  const primary = async () => response(403, { message: 'limit' }, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(resetAt) });
  const err2 = await fetchGitHub('https://api.github.com/x', { fetchImpl: primary, sleep: async () => {}, maxWaitMs: 0 }).catch((e) => e);
  assert.match(err2.message, /GITHUB_TOKEN/);
});
