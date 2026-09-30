import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cacheKey, createCache, TTL } from '../src/cache.mjs';
import { fakeCacheApi } from './helpers.mjs';

test('TTL table matches the spec', () => {
  assert.deepEqual(TTL, { recommend: 86400, repo: 21600, packages: 86400, trendingDay: 3600, trending: 21600, degraded: 3600 });
});

test('cacheKey: stable under key order, differs by value, hex only', async () => {
  const a = await cacheKey({ tool: 'x', args: { a: 1, b: [1, 2] } });
  assert.equal(a, await cacheKey({ args: { b: [1, 2], a: 1 }, tool: 'x' }));
  assert.notEqual(a, await cacheKey({ tool: 'x', args: { a: 2, b: [1, 2] } }));
  assert.match(a, /^[0-9a-f]{64}$/);
});

test('memory layer: hit before expiry, miss after', async () => {
  let t = 0;
  const cache = createCache({ cacheApi: null, now: () => t });
  await cache.put('k', { v: 1 }, 10);
  assert.deepEqual(await cache.get('k'), { v: 1 });
  t = 10_001;
  assert.equal(await cache.get('k'), undefined);
});

test('Cache API layer serves another isolate (fresh memory) until expiry', async () => {
  let t = 1000;
  const api = fakeCacheApi(() => t);
  await createCache({ cacheApi: api, now: () => t }).put('k', { v: 2 }, 60);
  const other = createCache({ cacheApi: api, now: () => t });
  assert.deepEqual(await other.get('k'), { v: 2 });
  t += 61_000;
  assert.equal(await createCache({ cacheApi: api, now: () => t }).get('k'), undefined);
});

test('wrap: produces once, caches with a TTL chosen from the value, never caches errors', async () => {
  let t = 0;
  const cache = createCache({ cacheApi: null, now: () => t });
  let runs = 0;
  const produce = async () => { runs++; return { degraded: runs === 1 }; };
  const ttl = (v) => (v.degraded ? 5 : 100);
  await cache.wrap('k', ttl, produce);
  await cache.wrap('k', ttl, produce);
  assert.equal(runs, 1);
  t = 5_001;
  await cache.wrap('k', ttl, produce);
  assert.equal(runs, 2);
  await assert.rejects(cache.wrap('e', 100, async () => { throw new Error('boom'); }));
  assert.equal(await cache.get('e'), undefined);
});

test('memory layer is bounded (oldest entries evicted)', async () => {
  const cache = createCache({ cacheApi: null, now: () => 0, maxEntries: 2 });
  await cache.put('a', 1, 100); await cache.put('b', 2, 100); await cache.put('c', 3, 100);
  assert.equal(await cache.get('a'), undefined);
  assert.equal(await cache.get('c'), 3);
});

test('a failing Cache API never fails the request', async () => {
  const broken = { match: async () => { throw new Error('x'); }, put: async () => { throw new Error('x'); } };
  const cache = createCache({ cacheApi: broken, now: () => 0 });
  await cache.put('k', 1, 10);
  assert.equal(await createCache({ cacheApi: broken, now: () => 0 }).get('k'), undefined);
});
