// The hosted tool call, shared by the web API and /mcp: hashed identity,
// burst guard, daily cap (anonymous callers only), cache, then the same
// tools as the npm package. Failures become HostedError(status, message).

import { createTools, ToolInputError } from '../../whichlib/mcp/tools.mjs';
import { createGitHubClient } from '../../whichlib/mcp/github-api.mjs';
import { toolDefinitions, HOSTED_LIMIT_NOTE } from '../../whichlib/mcp/definitions.mjs';
import { resolvePackages as realResolvePackages } from '../../whichlib/snapshot/src/registry.mjs';
import { GitHubRateLimitError, GitHubAuthError } from '../../whichlib/snapshot/src/github.mjs';
import { utcDay, nextUtcMidnight, userHash } from './identity.mjs';
import { checkBurst } from './limits.mjs';
import { cacheKey, TTL } from './cache.mjs';

export const HOSTED_DEFINITIONS = toolDefinitions({ limitNote: HOSTED_LIMIT_NOTE, compareNote: HOSTED_LIMIT_NOTE });

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

export function limitMessage(limit, msUntilReset) {
  const hours = Math.max(1, Math.ceil(msUntilReset / 3600_000));
  return `Daily free limit reached (${limit}). It resets in ${hours} h. For unlimited use add your own GitHub token (header X-GitHub-Token) or run the npm package locally: npx -y whichlib`;
}

// Only the raw fields normalizeRepo reads: a full repos/{name} payload is 6-8 KB, and the cache keeps up to hundreds of them.
export const REPO_FIELDS = ['full_name', 'html_url', 'description', 'language', 'stargazers_count', 'forks_count', 'open_issues_count', 'license', 'created_at', 'pushed_at', 'archived', 'topics'];
const slimRepo = (item) => Object.fromEntries(REPO_FIELDS.map((k) => [k, k === 'license' && item.license ? { key: item.license.key } : item[k]]));

/** Any download lookup that failed (package known, downloads unknown). */
const degraded = (repos) => repos.some((r) => (r.packages ?? []).some((p) => typeof p.weeklyDownloads !== 'number'));

function wholeResultTtl(name, args, result) {
  if (degraded(result.repos ?? [])) return TTL.degraded;
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
  return new HostedError(502, err?.message || 'Upstream request failed.');
}

export function createService({
  env, cache, counter, loadHistory, loadRising,
  makeGitHub = (token) => createGitHubClient({ token, maxWaitMs: 0 }),
  resolvePackages = realResolvePackages,
  now = Date.now,
}) {
  async function checkLimits(caller) {
    const t = now();
    const user = await userHash(caller.ip, env.IP_SALT ?? '', utcDay(t));
    if (!(await checkBurst(env.BURST, user))) {
      throw new HostedError(429, 'Too many calls: at most 20 calls per minute. Try again in a minute.', { headers: { 'Retry-After': '60' } });
    }
    if (caller.ownToken) return null;
    const { allowed, remaining } = await counter.hit(user, utcDay(t));
    const resetAt = nextUtcMidnight(t);
    const quota = { limit: counter.limit, remaining, resetAt };
    if (!allowed) throw new HostedError(429, limitMessage(counter.limit, resetAt - t), { quota, headers: { 'Retry-After': String(Math.ceil((resetAt - t) / 1000)) } });
    return quota;
  }

  async function buildTools(caller) {
    // Never undefined: createGitHubClient's default reads process.env, which a Worker lacks.
    const github = makeGitHub(caller.ownToken ?? env.GITHUB_TOKEN ?? null);
    const cachedGitHub = {
      hasToken: github.hasToken,
      searchRepos: (query, opts) => github.searchRepos(query, opts),
      // Keyed by name only: results are public, whoever's token fetched them.
      getRepo: async (name) => cache.wrap(await cacheKey({ item: 'repo', name: name.toLowerCase() }), TTL.repo, async () => slimRepo(await github.getRepo(name))),
    };
    const cachedResolve = async (repo, opts) => cache.wrap(
      await cacheKey({ item: 'packages', repo: repo.fullName.toLowerCase() }),
      (packages) => (degraded([{ packages }]) ? TTL.degraded : TTL.packages),
      () => resolvePackages(repo, opts),
    );
    return createTools({ github: cachedGitHub, resolvePackages: cachedResolve, history: await loadHistory(), loadRising, limitNote: HOSTED_LIMIT_NOTE, now });
  }

  return {
    async call(name, args, caller) {
      if (!METHODS[name]) throw new HostedError(400, `Unknown tool "${name}".`);
      const quota = await checkLimits(caller);
      try {
        const run = async () => (await buildTools(caller))[METHODS[name]](args);
        const result = name === 'compare_repos'
          ? await run() // per-repo entries are cached inside
          : await cache.wrap(await cacheKey({ tool: name, args }), (r) => wholeResultTtl(name, args, r), run);
        return { result, quota };
      } catch (err) {
        throw toHostedError(err, caller);
      }
    },
  };
}
