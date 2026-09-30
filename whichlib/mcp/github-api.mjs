// GitHub REST client for the MCP server: token from the environment, and a
// short in-memory cache so a chatty agent does not burn the rate limit
// (search: 10/min without a token, 30/min with one; core: 60/h vs 5000/h).

import { fetchGitHub, fetchSearch } from '../snapshot/src/github.mjs';
import { searchUrl } from '../snapshot/src/query.mjs';

// A tool call waits at most this long for a rate-limit reset; beyond it the
// agent gets an error it can act on instead of a call that hangs.
const MAX_RATE_LIMIT_WAIT_MS = 15_000;

export function createGitHubClient({ token = globalThis.process?.env?.GITHUB_TOKEN || null, fetchImpl = fetch, ttlMs = 10 * 60 * 1000, now = Date.now, maxWaitMs = MAX_RATE_LIMIT_WAIT_MS } = {}) {
  const cache = new Map();

  async function cached(key, produce) {
    const hit = cache.get(key);
    if (hit && now() - hit.at < ttlMs) return hit.value;
    const value = await produce();
    cache.set(key, { at: now(), value });
    return value;
  }

  return {
    hasToken: Boolean(token),

    /** Search repositories. sort: 'stars' (default) or 'best-match'. */
    searchRepos(query, { perPage = 30, sort = 'stars' } = {}) {
      const url = sort === 'stars'
        ? searchUrl(query, { perPage })
        : `https://api.github.com/search/repositories?${new URLSearchParams({ q: query, per_page: String(perPage) })}`;
      return cached(url, () => fetchSearch(url, { token, fetchImpl, maxWaitMs }));
    },

    /** One repository, raw API shape (same field names as search items). */
    getRepo(fullName) {
      const url = `https://api.github.com/repos/${fullName}`;
      return cached(url, () => fetchGitHub(url, { token, fetchImpl, maxWaitMs }));
    },
  };
}
