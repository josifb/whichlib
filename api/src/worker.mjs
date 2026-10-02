// whichlib hosted API (Cloudflare Worker): /api/* JSON and /mcp remote MCP.
// Pages are static assets (site/), served without running this code;
// wrangler.toml routes only /api/* and /mcp here. Bindings: DB (D1: daily_usage and the call counter's events), BURST (rate limit);
// secrets: GITHUB_TOKEN, IP_SALT.

import { createRisingLoader } from '../../whichlib/mcp/history-provider.mjs';
import { clientIp } from './identity.mjs';
import { createDailyCounter } from './limits.mjs';
import { createCache } from './cache.mjs';
import { createHistoryLoader } from './history.mjs';
import { createService } from './service.mjs';
import { handleApi } from './web-api.mjs';
import { handleMcp } from './mcp.mjs';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept, X-GitHub-Token, Mcp-Protocol-Version, Mcp-Session-Id, Last-Event-ID',
  'Access-Control-Expose-Headers': 'X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, Retry-After, Mcp-Session-Id',
  'Access-Control-Max-Age': '86400',
};

// One per isolate (see createWorker); tests create their own.
function makeSharedState(hostname, env) {
  return {
    // caches.default is a no-op on *.workers.dev: skip it there (saves a match and a put per miss).
    cache: createCache({ cacheApi: hostname.endsWith('.workers.dev') ? null : globalThis.caches?.default ?? null }),
    // Per-repo entries stay in memory only: Cache API calls count against the 50 subrequests per request.
    itemCache: createCache({ cacheApi: null }),
    // One counter per isolate: it remembers who is over the limit today without querying D1 again.
    counter: createDailyCounter(env.DB),
    loadHistory: createHistoryLoader(),
    loadRising: createRisingLoader(),
  };
}

function withCors(response) {
  const res = new Response(response.body, response);
  for (const [k, v] of Object.entries(CORS)) res.headers.set(k, v);
  return res;
}

/** X-GitHub-Token, with an optional "Bearer " / "token " prefix; null when absent. Never logged. */
export function ownToken(request) {
  const raw = request.headers.get('X-GitHub-Token')?.trim().replace(/^(bearer|token)(\s+|$)/i, '');
  return raw || null;
}

/** The Worker with its own shared state: the caches, the counter, history and the rising list live as long as the isolate. */
export function createWorker() {
  let shared = null;
  return {
    async fetch(request, env, ctx) {
      try {
        if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
        const { pathname, hostname } = new URL(request.url);
        const caller = { ip: clientIp(request), ownToken: ownToken(request) };
        const waitUntil = ctx?.waitUntil ? (p) => ctx.waitUntil(p) : null;
        const service = () => createService({ env, waitUntil, ...(shared ??= makeSharedState(hostname, env)) });

        if (pathname.startsWith('/api/')) return withCors(await handleApi(request, service(), caller));
        if (pathname === '/mcp') return withCors(await handleMcp(request, service(), caller));
        return withCors(Response.json({ error: 'Not found.' }, { status: 404 }));
      } catch (err) {
        console.error('worker error', err?.stack ?? err);
        return withCors(Response.json({ error: 'Internal error.' }, { status: 500 }));
      }
    },
  };
}

export default createWorker();
