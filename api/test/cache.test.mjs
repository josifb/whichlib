import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cacheKey, createCache, TTL } from '../src/cache.mjs';
import { fakeCacheApi } from './helpers.mjs';

const tick = () => new Promise((r) => setImmediate(r));

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

test('wrap: coalesces concurrent misses into one produce() call', async () => {
  const cache = createCache({ cacheApi: null, now: () => 0 });
  let runs = 0;
  let resolve;
  const produce = () => new Promise((res) => { runs++; resolve = res; });
  const p1 = cache.wrap('k', 100, produce);
  const p2 = cache.wrap('k', 100, produce);
  await tick(); // produce() starts after the cache lookup
  resolve(42);
  const [v1, v2] = await Promise.all([p1, p2]);
  assert.equal(runs, 1);
  assert.equal(v1, 42);
  assert.equal(v2, 42);
});

test('wrap: a concurrent rejection is shared and never cached', async () => {
  const cache = createCache({ cacheApi: null, now: () => 0 });
  let runs = 0;
  let reject;
  const produce = () => new Promise((_res, rej) => { runs++; reject = rej; });
  const p1 = cache.wrap('k', 100, produce);
  const p2 = cache.wrap('k', 100, produce);
  await tick();
  reject(new Error('boom'));
  await assert.rejects(p1);
  await assert.rejects(p2);
  assert.equal(runs, 1);
  assert.equal(await cache.get('k'), undefined);
});

test('byte budget evicts oldest entries when the total exceeds maxBytes', async () => {
  const cache = createCache({ cacheApi: null, now: () => 0, maxBytes: 30, maxEntries: 100 });
  await cache.put('a', 'x'.repeat(10), 100);
  await cache.put('b', 'x'.repeat(10), 100);
  await cache.put('c', 'x'.repeat(10), 100);
  assert.equal(await cache.get('a'), undefined);
  assert.notEqual(await cache.get('c'), undefined);
});

test('an entry over maxEntryBytes skips the memory layer but is served from the Cache API', async () => {
  let t = 0;
  const api = fakeCacheApi(() => t);
  let matchCalls = 0;
  const counting = { ...api, match: async (req) => { matchCalls++; return api.match(req); } };
  const cache = createCache({ cacheApi: counting, now: () => t, maxEntryBytes: 5 });
  await cache.put('k', 'x'.repeat(100), 60);
  assert.equal(await cache.get('k'), 'x'.repeat(100));
  assert.equal(await cache.get('k'), 'x'.repeat(100));
  assert.equal(matchCalls, 2); // never served from memory, so every get asks the Cache API
});

test('put: ttl 0 or NaN is not cached', async () => {
  const cache = createCache({ cacheApi: null, now: () => 0 });
  await cache.put('a', 1, 0);
  await cache.put('b', 1, NaN);
  assert.equal(await cache.get('a'), undefined);
  assert.equal(await cache.get('b'), undefined);
});

test('a layer-2 hit copied into memory keeps the original expiry, not a fresh TTL', async () => {
  let t = 0;
  const api = fakeCacheApi(() => t);
  await createCache({ cacheApi: api, now: () => t }).put('k', { v: 1 }, 60);
  t = 50_000; // near the original expiry
  const cache = createCache({ cacheApi: api, now: () => t });
  assert.deepEqual(await cache.get('k'), { v: 1 }); // pulls the value into this isolate's memory
  t = 61_000; // past the original expiry, well before a fresh 60s TTL would end
  assert.equal(await cache.get('k'), undefined);
});
