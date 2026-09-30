import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleApi, parseArgs } from '../src/web-api.mjs';
import { HostedError } from '../src/service.mjs';

const anon = { ip: '1.2.3.4', ownToken: null };
const RESET = Date.parse('2026-10-02T00:00:00Z');

function fakeService(outcome) {
  const seen = [];
  return { seen, async call(name, args, caller) { seen.push({ name, args, caller }); if (outcome instanceof Error) throw outcome; return outcome; } };
}
const get = (path) => new Request(`https://w.test${path}`);

test('parseArgs converts query strings', () => {
  assert.deepEqual(parseArgs('recommend_repos', new URLSearchParams('need=pdf+parser&language=Python&limit=3')), { need: 'pdf parser', language: 'Python', limit: 3 });
  assert.deepEqual(parseArgs('compare_repos', new URLSearchParams('repos=a/b, c/d,')), { repos: ['a/b', 'c/d'] });
  assert.deepEqual(parseArgs('trending_repos', new URLSearchParams('period=day&withDownloads=true')), { period: 'day', withDownloads: true });
  assert.deepEqual(parseArgs('trending_repos', new URLSearchParams('withDownloads=0')), { withDownloads: false });
});

test('success: 200, the structured result, rate headers for anonymous callers', async () => {
  const service = fakeService({ result: { tool: 'trending_repos', repos: [] }, quota: { limit: 50, remaining: 42, resetAt: RESET } });
  const res = await handleApi(get('/api/trending?period=day&limit=5'), service, anon);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { tool: 'trending_repos', repos: [] });
  assert.equal(res.headers.get('X-RateLimit-Limit'), '50');
  assert.equal(res.headers.get('X-RateLimit-Remaining'), '42');
  assert.equal(res.headers.get('X-RateLimit-Reset'), String(RESET / 1000));
  assert.deepEqual(service.seen[0].args, { period: 'day', limit: 5, withDownloads: false });
});

test('own token: no rate headers', async () => {
  const res = await handleApi(get('/api/compare?repos=a/b,c/d'), fakeService({ result: { repos: [] }, quota: null }), { ip: '1.2.3.4', ownToken: 't' });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('X-RateLimit-Remaining'), null);
});

test('bad input: 400 with a readable message, and the service is not called (not counted)', async () => {
  for (const path of ['/api/recommend', '/api/recommend?need=pdf&limit=abc', '/api/compare?repos=a/b', '/api/trending?period=year', '/api/trending?withDownloads=maybe']) {
    const service = fakeService({ result: {}, quota: null });
    const res = await handleApi(get(path), service, anon);
    assert.equal(res.status, 400, path);
    assert.equal(typeof (await res.json()).error, 'string');
    assert.equal(service.seen.length, 0, path);
  }
});

test('HostedError: status, JSON error, its headers; daily limit keeps rate headers', async () => {
  const limit = new HostedError(429, 'Daily free limit reached (50).', { quota: { limit: 50, remaining: 0, resetAt: RESET }, headers: { 'Retry-After': '100' } });
  const res = await handleApi(get('/api/trending'), fakeService(limit), anon);
  assert.equal(res.status, 429);
  assert.deepEqual(await res.json(), { error: 'Daily free limit reached (50).' });
  assert.equal(res.headers.get('Retry-After'), '100');
  assert.equal(res.headers.get('X-RateLimit-Remaining'), '0');
  const busy = await handleApi(get('/api/trending'), fakeService(new HostedError(503, 'whichlib is busy', { headers: { 'Retry-After': '30' } })), anon);
  assert.equal(busy.status, 503);
});

test('unknown endpoint 404, wrong method 405, unexpected error 500', async () => {
  assert.equal((await handleApi(get('/api/nope'), fakeService({}), anon)).status, 404);
  assert.equal((await handleApi(new Request('https://w.test/api/trending', { method: 'POST' }), fakeService({}), anon)).status, 405);
  assert.equal((await handleApi(get('/api/trending'), fakeService(new TypeError('bug')), anon)).status, 500);
});

test('HEAD is 405 and unknown query keys are a 400 naming the key', async () => {
  const service = fakeService({ result: {}, quota: null });
  assert.equal((await handleApi(new Request('https://w.test/api/trending', { method: 'HEAD' }), service, anon)).status, 405);
  const res = await handleApi(get('/api/recommend?need=pdf&lang=python'), service, anon);
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /lang/);
  assert.equal(service.seen.length, 0);
});
