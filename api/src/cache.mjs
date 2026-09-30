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

export function createCache({ cacheApi = null, now = Date.now, maxEntries = 500 } = {}) {
  const memory = new Map(); // key -> { expires, value }; insertion order = age

  function remember(key, value, expires) {
    memory.delete(key);
    memory.set(key, { expires, value });
    while (memory.size > maxEntries) memory.delete(memory.keys().next().value);
  }

  async function get(key) {
    const hit = memory.get(key);
    if (hit && hit.expires > now()) return hit.value;
    if (hit) memory.delete(key);
    if (!cacheApi) return undefined;
    try {
      const res = await cacheApi.match(new Request(KEY_ORIGIN + key));
      if (!res) return undefined;
      const expires = Number(res.headers.get('X-Expires'));
      if (!(expires > now())) return undefined;
      const value = await res.json();
      remember(key, value, expires);
      return value;
    } catch {
      return undefined;
    }
  }

  async function put(key, value, ttlSeconds) {
    const expires = now() + ttlSeconds * 1000;
    remember(key, value, expires);
    if (!cacheApi) return;
    try {
      await cacheApi.put(new Request(KEY_ORIGIN + key), new Response(JSON.stringify(value), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${ttlSeconds}`, 'X-Expires': String(expires) },
      }));
    } catch { /* a cache write failure must not fail the call */ }
  }

  /** Cached value for key, or produce() it and cache it. ttl: seconds, or a function of the value. */
  async function wrap(key, ttl, produce) {
    const hit = await get(key);
    if (hit !== undefined) return hit;
    const value = await produce();
    await put(key, value, typeof ttl === 'function' ? ttl(value) : ttl);
    return value;
  }

  return { get, put, wrap };
}
