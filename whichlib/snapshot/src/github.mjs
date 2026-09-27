// Thin GitHub Search API client. Unauthenticated search allows 10 requests
// per minute, authenticated 30. We pace requests between calls and, if we
// still hit the limit, wait for the reset and retry once.

const USER_AGENT = 'whichlib/0.1 (+https://github.com/josifb/whichlib)';

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Milliseconds to wait between consecutive search requests. */
export function paceDelayMs(hasToken) {
  return hasToken ? 2100 : 6500;
}

function isRateLimited(res) {
  return (res.status === 403 || res.status === 429) && res.headers.get('x-ratelimit-remaining') === '0';
}

function msUntilReset(res) {
  const reset = Number(res.headers.get('x-ratelimit-reset'));
  if (!Number.isFinite(reset) || reset <= 0) return 60_000;
  return Math.max(1000, reset * 1000 - Date.now() + 1000);
}

/**
 * GET any GitHub REST URL as JSON, with the standard headers, optional
 * token, and one wait-and-retry when the rate limit is exhausted.
 */
export async function fetchGitHub(url, { token = null, fetchImpl = fetch, sleep = defaultSleep } = {}) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': USER_AGENT,
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  let res = await fetchImpl(url, { headers });
  if (isRateLimited(res)) {
    await sleep(msUntilReset(res));
    res = await fetchImpl(url, { headers });
  }
  if (!res.ok) {
    let message = '';
    try { message = (await res.json()).message ?? ''; } catch { /* body not JSON */ }
    throw new Error(`GitHub request failed: ${res.status} ${message}`.trim());
  }
  return res.json();
}

/**
 * Fetch one Search API page.
 * @returns {Promise<{items: object[], totalCount: number}>}
 */
export async function fetchSearch(url, opts = {}) {
  const body = await fetchGitHub(url, opts);
  return { items: body.items ?? [], totalCount: body.total_count ?? 0 };
}
