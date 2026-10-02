// The hosted tool call, shared by the web API and /mcp: hashed identity,
// burst guard, daily cap (anonymous callers only), cache, then the same
// tools as the npm package. Failures become HostedError(status, message).

import { createTools, ToolInputError } from '../../whichlib/mcp/tools.mjs';
import { createGitHubClient } from '../../whichlib/mcp/github-api.mjs';
import { toolDefinitions, HOSTED_LIMIT_NOTE } from '../../whichlib/mcp/definitions.mjs';
import { resolvePackages as realResolvePackages } from '../../whichlib/snapshot/src/registry.mjs';
import { GitHubRateLimitError, GitHubAuthError } from '../../whichlib/snapshot/src/github.mjs';
import { utcDay, nextUtcMidnight, userHash } from './identity.mjs';
import { checkBurst, BURST_LIMIT } from './limits.mjs';
import { cacheKey, TTL } from './cache.mjs';
import { createJevJudge, JEV_MODEL } from '../../whichlib/mcp/jev.mjs';
import { recordHostedCall } from './events.mjs';

export const HOSTED_DEFINITIONS = toolDefinitions({ limitNote: HOSTED_LIMIT_NOTE, compareNote: HOSTED_LIMIT_NOTE });

/**
 * Free plan allows 50 subrequests per request. The rest is for what sits outside the budget:
 * the whole-result Cache API match + put (2), history and rising downloads on a cold isolate (~2);
 * D1 queries do not count as fetch subrequests.
 */
export const TOOL_SUBREQUESTS = 35;

/** Thrown by the budget fetch; cachedResolve uses it to mark a caller degraded even when it only joined the lookup. */
export class BudgetError extends Error {
  constructor() { super('subrequest budget reached'); this.name = 'BudgetError'; }
}
const BUDGET_NOTE = 'Download counts were skipped for some repositories to stay within the hosted request limit; run the npm package locally for full data.';

const METHODS = { recommend_repos: 'recommend', compare_repos: 'compare', trending_repos: 'trending' };

export class HostedError extends Error {
  constructor(status, message, { headers = {}, quota = null } = {}) {
    super(message);
    this.name = 'HostedError';
    this.status = status;
    this.headers = headers;
    this.quota = quota;
  }
}

/**
 * Per-call fetch wrapper: counts subrequests (BudgetError past `max`) and, for non-GitHub hosts,
 * turns 429 and 5xx into an immediate error. The package's getJson would otherwise sleep and
 * retry for up to 43 s, which a hosted call must never do. GitHub responses pass through
 * (fetchGitHub has its own rate-limit handling). `busy` records that a registry refused.
 */
export function createBudget(fetchImpl, max = TOOL_SUBREQUESTS) {
  const budget = { used: 0, exhausted: false, busy: false };
  budget.fetch = async (url, ...rest) => {
    if (budget.used >= max) { budget.exhausted = true; throw new BudgetError(); }
    budget.used++;
    const res = await fetchImpl(url, ...rest);
    const host = new URL(typeof url === 'string' ? url : url.url).hostname;
    if (host !== 'api.github.com' && (res.status === 429 || res.status >= 500)) {
      budget.busy = true;
      throw Object.assign(new Error(`registry busy: ${host} ${res.status}`), { status: res.status });
    }
    return res;
  };
  return budget;
}

export function limitMessage(limit, msUntilReset) {
  const hours = Math.max(1, Math.ceil(msUntilReset / 3600_000));
  return `Daily free limit reached (${limit}). It resets in ${hours} h. For unlimited use add your own GitHub token (header X-GitHub-Token) or run the npm package locally: npx -y whichlib`;
}

// Only the raw fields normalizeRepo reads: a full repos/{name} payload is 6-8 KB, and the cache keeps up to hundreds of them.
export const REPO_FIELDS = ['full_name', 'html_url', 'description', 'language', 'stargazers_count', 'forks_count', 'open_issues_count', 'license', 'created_at', 'pushed_at', 'archived', 'topics'];
const slimRepo = (item) => Object.fromEntries(REPO_FIELDS.map((k) => [k, k === 'license' && item.license ? { key: item.license.key } : item[k]]));

/** Any download lookup that failed (package known, downloads unknown). */
const degraded = (repos) => repos.some((r) => (r.packages ?? []).some((p) => typeof p.weeklyDownloads !== 'number'));

// Whole results are keyed on the normalised question, so 'Python' and 'python' share an entry.
function normaliseArgs(args) {
  const out = { ...args };
  if (typeof out.language === 'string') out.language = out.language.toLowerCase();
  if (typeof out.need === 'string') out.need = out.need.trim().replace(/\s+/g, ' ');
  return out;
}

// Period 'rising' deliberately uses TTL.trending (6 h): the list itself changes once a day.
function wholeResultTtl(name, args, result) {
  if (degraded(result.repos ?? [])) return TTL.degraded;
  if (result.fitJudge === 'rules (judge unavailable)') return TTL.degraded;
  if (name === 'recommend_repos') return TTL.recommend;
  return args.period === 'day' ? TTL.trendingDay : TTL.trending;
}

function toHostedError(err, caller) {
  if (err instanceof HostedError) return err;
  if (err instanceof ToolInputError) return new HostedError(400, err.message);
  if (err instanceof GitHubAuthError) {
    if (caller.ownToken) return new HostedError(401, 'Your GitHub token was rejected by GitHub (HTTP 401). Check the X-GitHub-Token header, or leave it out to use the free tier.');
    console.error('server GITHUB_TOKEN rejected by GitHub');
    return new HostedError(502, 'whichlib could not authenticate with GitHub; please try again later.');
  }
  if (err instanceof GitHubRateLimitError) {
    const headers = { 'Retry-After': String(err.resetSeconds) };
    if (caller.ownToken) return new HostedError(429, `Your GitHub token's rate limit is reached; try again in ${err.resetSeconds} seconds.`, { headers });
    return new HostedError(503, `whichlib is busy, try again in ${err.resetSeconds} seconds, or use your own GitHub token (header X-GitHub-Token).`, { headers });
  }
  // tools.mjs reports nothing-found as a plain Error; that is the caller's input, not an outage.
  if (err?.message?.startsWith('Could not fetch any of the repositories')) return new HostedError(404, err.message);
  const known = /^(Could not fetch|GitHub )/.test(err?.message ?? '');
  if (!known) console.error('upstream error', err?.stack ?? err);
  return new HostedError(502, known ? err.message : 'Upstream request failed.');
}

export function createService({
  env, cache, itemCache, counter, loadHistory, loadRising,
  makeGitHub = (token, fetchImpl) => createGitHubClient({ token, fetchImpl, maxWaitMs: 0 }),
  fetchImpl = fetch,
  resolvePackages = realResolvePackages,
  now = Date.now,
  waitUntil = null,
}) {
  async function checkLimits(caller) {
    try {
      const t = now();
      const day = utcDay(t);
      const user = await userHash(caller.ip, env.IP_SALT ?? '', day);
      if (!(await checkBurst(env.BURST, user))) {
        throw new HostedError(429, `Too many calls: at most ${BURST_LIMIT} calls per minute. Try again in a minute.`, { headers: { 'Retry-After': '60' } });
      }
      if (caller.ownToken) return { quota: null, user, day, counted: false };
      const { allowed, remaining } = await counter.hit(user, day);
      const resetAt = nextUtcMidnight(t);
      const quota = { limit: counter.limit, remaining, resetAt };
      if (!allowed) throw new HostedError(429, limitMessage(counter.limit, resetAt - t), { quota, headers: { 'Retry-After': String(Math.ceil((resetAt - t) / 1000)) } });
      return { quota, user, day, counted: true };
    } catch (err) {
      if (err instanceof HostedError) throw err;
      console.error('limits error', err?.message);
      throw new HostedError(503, 'whichlib is temporarily unavailable; please try again in a minute.');
    }
  }

  // Own-token callers may read the caches but never write to them or share in-flight work:
  // their token can see private repos, and whatever it fetched must not reach anyone else.
  const through = (c, caller) => (caller.ownToken
    ? async (key, _ttl, produce) => {
      const hit = await c.get(key);
      return hit !== undefined ? hit : produce();
    }
    : (key, ttl, produce) => c.wrap(key, ttl, produce));

  const judgeEnabled = (caller) => Boolean(env.TYPESAFE_API_KEY) && !caller.ownToken;

  async function buildTools(caller, budget) {
    const github = makeGitHub(caller.ownToken ?? env.GITHUB_TOKEN ?? null, budget.fetch);
    const item = through(itemCache, caller);
    const cachedGitHub = {
      hasToken: github.hasToken,
      searchRepos: (query, opts) => github.searchRepos(query, opts),
      // Keyed by name only: results are public, whoever's token fetched them (own-token callers never write).
      getRepo: async (name) => item(await cacheKey({ item: 'repo', name: name.toLowerCase() }), TTL.repo, async () => slimRepo(await github.getRepo(name))),
    };
    const cachedResolve = async (repo, opts) => item(
      await cacheKey({ item: 'packages', repo: repo.fullName.toLowerCase() }),
      // 0 = not cached: a lookup cut short by the budget must not stick.
      (packages) => (budget.exhausted ? 0 : degraded([{ packages }]) ? TTL.degraded : TTL.packages),
      () => resolvePackages(repo, { ...opts, fetchImpl: budget.fetch }),
    ).catch((err) => {
      // Covers a caller that only joined someone else's starved lookup, too.
      if (err instanceof BudgetError) budget.exhausted = true;
      throw err;
    });
    // Hosted only: TypeSafe Jev judges each candidate's fit (whichlib/mcp/jev.mjs). Its requests go
    // through the budget fetch, so they count against TOOL_SUBREQUESTS (~3 per recommend) and a
    // 429/5xx fails at once; recommend then falls back to the word-match rules for this call.
    // Never for own-token callers: their token can see private repos, whose metadata must not go to
    // TypeSafe (it also keeps unmetered callers off the service's TypeSafe key). They get the rules ranking.
    const judge = judgeEnabled(caller) ? createJevJudge({ apiKey: env.TYPESAFE_API_KEY, fetchImpl: budget.fetch }) : null;
    // tools.mjs swallows judge failures (it falls back); log them here so they show in `wrangler tail`.
    const judgeFit = judge && Object.assign(async (...a) => {
      try { return await judge(...a); } catch (err) {
        console.error('jev failed', err?.status ?? '', err?.requestId ?? '', err?.message);
        throw err;
      }
    }, { model: judge.model });
    return createTools({ github: cachedGitHub, resolvePackages: cachedResolve, history: await loadHistory(), loadRising, limitNote: HOSTED_LIMIT_NOTE, judgeFit, now });
  }

  return {
    async call(name, args, caller) {
      if (!METHODS[name]) throw new HostedError(400, `Unknown tool "${name}".`);
      const { quota, user, day, counted } = await checkLimits(caller);
      // Counted once the limits let the call through (before it runs, so an upstream failure still counts).
      const event = recordHostedCall(env.DB, name, { now });
      if (waitUntil) waitUntil(event); else await event;
      const budget = createBudget(fetchImpl);
      try {
        const run = async () => {
          const result = await (await buildTools(caller, budget))[METHODS[name]](args);
          // A new object: the one above may be shared with a cache.
          return budget.exhausted ? { ...result, dataNotes: [...(result.dataNotes ?? []), BUDGET_NOTE] } : result;
        };
        const result = name === 'compare_repos'
          ? await run() // per-repo entries are cached inside
          : await through(cache, caller)(await cacheKey({ tool: name, args: normaliseArgs(args), ...(name === 'recommend_repos' && judgeEnabled(caller) ? { judge: JEV_MODEL } : {}) }), (r) => (budget.exhausted || budget.busy ? TTL.degraded : wholeResultTtl(name, args, r)), run);
        return { result, quota };
      } catch (err) {
        const hosted = toHostedError(err, caller);
        // Give the call back only when whichlib's own setup failed (shared GitHub limit, rejected server token).
        // Other 502s stay counted: otherwise callers could spend the server token for free.
        if (counted && (err instanceof GitHubRateLimitError || err instanceof GitHubAuthError)) {
          await counter.refund(user, day).catch((e) => console.error('refund failed', e?.message));
        }
        throw hosted;
      }
    },
  };
}
