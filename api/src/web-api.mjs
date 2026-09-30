// GET /api/recommend | /api/compare | /api/trending: query string -> the
// same zod input shapes as the MCP tools -> service -> the tool's structured
// result as JSON. Errors: { "error": "<message>" }.

import { inputObject } from '../../whichlib/mcp/definitions.mjs';
import { HostedError, HOSTED_DEFINITIONS } from './service.mjs';

const ROUTES = { '/api/recommend': 'recommend_repos', '/api/compare': 'compare_repos', '/api/trending': 'trending_repos' };
const SCHEMAS = Object.fromEntries(HOSTED_DEFINITIONS.map((d) => [d.name, inputObject(d)]));
const BOOL = { true: true, 1: true, false: false, 0: false };

const json = (status, body, headers = {}) => Response.json(body, { status, headers });

/** Query string -> tool arguments, before validation. Unknown values pass through for zod to reject. */
export function parseArgs(name, params) {
  const args = {};
  for (const [key, value] of params) {
    if (key === 'limit') args.limit = value.trim() === '' ? NaN : Number(value);
    else if (key === 'withDownloads') args.withDownloads = Object.hasOwn(BOOL, value) ? BOOL[value] : value;
    else if (key === 'repos' && name === 'compare_repos') args.repos = value.split(',').map((s) => s.trim()).filter(Boolean);
    else args[key] = value;
  }
  return args;
}

function quotaHeaders(quota) {
  if (!quota) return {};
  return { 'X-RateLimit-Limit': String(quota.limit), 'X-RateLimit-Remaining': String(quota.remaining), 'X-RateLimit-Reset': String(Math.floor(quota.resetAt / 1000)) };
}

export async function handleApi(request, service, caller) {
  const url = new URL(request.url);
  const name = ROUTES[url.pathname];
  if (!name) return json(404, { error: 'Unknown endpoint. Use /api/recommend, /api/compare or /api/trending.' });
  if (request.method !== 'GET' && request.method !== 'HEAD') return json(405, { error: 'Use GET.' }, { Allow: 'GET' });

  const parsed = SCHEMAS[name].safeParse(parseArgs(name, url.searchParams));
  if (!parsed.success) {
    const message = parsed.error.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ');
    return json(400, { error: message });
  }
  try {
    const { result, quota } = await service.call(name, parsed.data, caller);
    return json(200, result, quotaHeaders(quota));
  } catch (err) {
    if (err instanceof HostedError) return json(err.status, { error: err.message }, { ...quotaHeaders(err.quota), ...err.headers });
    console.error('api error', err?.stack ?? err);
    return json(500, { error: 'Internal error.' });
  }
}
