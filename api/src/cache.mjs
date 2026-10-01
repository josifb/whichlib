// Result cache. Layer 1: a bounded Map in this isolate (the only layer that
// works on *.workers.dev). Layer 2: caches.default (per data centre; only on
// a custom domain). Keys are SHA-256 hashes; values are JSON.

import { sha256Hex } from './identity.mjs';

/** Seconds. degraded: a result where an npm/PyPI lookup failed, so it does not stick for a day. */
export const TTL = { recommend: 86400, repo: 21600, packages: 86400, trendingDay: 3600, trending: 21600, degraded: 3600 };

const KEY_ORIGIN = 'https://cache.whichlib.invalid/';

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((k) => [k, canonical(value[k])]));
  }
  return value;
}

export function cacheKey(parts) {
  return sha256Hex(JSON.stringify(canonical(parts)));
}

export function createCache({
  cacheApi = null, now = Date.now, maxEntries = 500, maxBytes = 24 * 1024 * 1024, maxEntryBytes = 256 * 1024,
} = {}) {
  // key -> { expires, value, bytes }. Insertion order is age: eviction drops the
  // oldest entry first (not LRU, a read never reorders). Values are shared
  // references between callers, so treat them as immutable.
  const memory = new Map();
  let totalBytes = 0;
  const inflight = new Map(); // key -> promise of the running produce(), see wrap()

  function forget(key) {
    const entry = memory.get(key);
    if (!entry) return;
    totalBytes -= entry.bytes;
    memory.delete(key);
  }

  function remember(key, value, expires, bytes) {
    forget(key);
    if (bytes > maxEntryBytes) return; // too big for the isolate; still goes to the Cache API
    memory.set(key, { expires, value, bytes });
    totalBytes += bytes;
    while ((totalBytes > maxBytes || memory.size > maxEntries) && memory.size > 0) {
      forget(memory.keys().next().value);
    }
  }

  async function get(key) {
    const hit = memory.get(key);
    if (hit && hit.expires > now()) return hit.value;
    if (hit) forget(key);
    if (!cacheApi) return undefined;
    // Also after an expired memory entry: another isolate may have written a fresher copy.
    try {
      const res = await cacheApi.match(new Request(KEY_ORIGIN + key));
      if (!res) return undefined;
      const expires = Number(res.headers.get('X-Expires'));
      if (!(expires > now())) return undefined;
      const body = await res.text();
      const value = JSON.parse(body);
      console.log('cache: shared hit');
      remember(key, value, expires, body.length); // original expiry, not a fresh TTL
      return value;
    } catch {
      return undefined;
    }
  }

  async function put(key, value, ttlSeconds) {
    if (!(ttlSeconds > 0)) return; // zero, negative or NaN: do not cache
    const expires = now() + ttlSeconds * 1000;
    const body = JSON.stringify(value);
    remember(key, value, expires, body.length);
    if (!cacheApi) return;
    try {
      await cacheApi.put(new Request(KEY_ORIGIN + key), new Response(body, {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${ttlSeconds}`, 'X-Expires': String(expires) },
      }));
    } catch { /* a cache write failure must not fail the call */ }
  }

  /**
   * Cached value for key, or produce() it and cache it. ttl: seconds, or a function of the value.
   * Concurrent misses for one key share a single produce(); a rejection is shared too and never cached.
   */
  async function wrap(key, ttl, produce) {
    const hit = await get(key);
    if (hit !== undefined) return hit;
    const running = inflight.get(key);
    if (running) return running;
    const promise = (async () => {
      const value = await produce();
      await put(key, value, typeof ttl === 'function' ? ttl(value) : ttl);
      return value;
    })();
    inflight.set(key, promise);
    try {
      return await promise;
    } finally {
      inflight.delete(key);
    }
  }

  return { get, put, wrap };
}
