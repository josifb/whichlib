// The three MCP tools, with every dependency injected so they can be tested
// with fakes. Each returns a plain object (the structuredContent) that
// formatResult() renders as text for clients that only read text.

import { normalizeRepo } from '../snapshot/src/normalize.mjs';
import { buildSearchQuery, PERIODS } from '../snapshot/src/query.mjs';
import scoreLib from '../lib/score.js';
import { expandNeed, mentionLevel, asksForLibrary, looksLikeLibrary } from './expand.mjs';
import { GitHubRateLimitError, GitHubAuthError } from '../snapshot/src/github.mjs';

/** Bad tool input (as opposed to a failure upstream). The hosted API answers these with HTTP 400. */
export class ToolInputError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ToolInputError';
  }
}

const REPO_NAME = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\/(?!\.\.?$)[A-Za-z0-9._-]+$/;
const RELEVANCE_WINDOW = 25;  // best-match results requested
const RELEVANCE_DECAY = 0.5;  // rank 1 -> 1.0, rank 25 -> 0.5
const RELEVANCE_TOPIC = 0.75; // not in the text results, but the maintainers tagged the topic
const RELEVANCE_ABSENT = 0.4; // present only in the stars-sorted results
// How strongly the candidate says it is about the subject: in its name or description,
// only in its topic tags (loose: every result of a topic query has the tag), or nowhere
// (matched README text only).
const MENTION_FACTOR = { text: 1, topic: 0.75, none: 0.5 };
const NOT_LIBRARY_FACTOR = 0.8; // the user asked for a framework/library/parser and the candidate reads like an application
const LANGUAGE_NEEDS_QUOTES = /[^A-Za-z0-9_-]/;

// Repeated language qualifiers act as OR in GitHub search (verified 2026-09-27).
// Many JavaScript libraries are written in TypeScript now, and Python libraries
// sometimes show as Jupyter Notebook, so a request for one includes the other.
const LANGUAGE_FAMILY = {
  javascript: ['JavaScript', 'TypeScript'],
  typescript: ['TypeScript', 'JavaScript'],
  python: ['Python', 'Jupyter Notebook'],
  'jupyter notebook': ['Jupyter Notebook', 'Python'],
};
const quoteLanguage = (l) => `language:${LANGUAGE_NEEDS_QUOTES.test(l) ? `"${l}"` : l}`;
const languageQualifier = (language) => {
  if (!language) return null;
  const family = LANGUAGE_FAMILY[String(language).toLowerCase()] ?? [language];
  return family.map(quoteLanguage).join(' ');
};

/** Download trend over all of a repo's packages that have one: total last week over total baseline week. */
function combinedTrend(packages) {
  const withTrend = packages.filter((p) => typeof p.downloadsTrend === 'number' && p.downloadsTrend > 0 && typeof p.weeklyDownloads === 'number');
  if (withTrend.length === 0) return null;
  const recent = withTrend.reduce((s, p) => s + p.weeklyDownloads, 0);
  const baseline = withTrend.reduce((s, p) => s + p.weeklyDownloads / p.downloadsTrend, 0);
  return Math.round((recent / baseline) * 100) / 100;
}

/** "(+70 in 7d)" when measured over a week, "(~+210/wk, estimated)" when scaled up from fewer days. */
function gainText(r) {
  if (r.starsGained7d === null || r.starsGained7d === undefined) return '';
  return r.starsGainedEstimated ? ` (~+${nf.format(r.starsGained7d)}/wk, estimated)` : ` (+${nf.format(r.starsGained7d)} in 7d)`;
}

export function createTools({ github, resolvePackages, history, loadRising = null, limitNote = null, now = () => Date.now() }) {
  const registryCache = {}; // repo -> package names, for the life of the process

  function dataNotes() {
    const notes = [];
    notes.push(history.spanDays >= 3
      ? `Momentum uses real stars gained per week from ${history.days} days of daily star counts (latest ${history.latestDate}; the top 1,000 repos per language plus new trending repos); other repos fall back to stars per day since creation.${history.spanDays < 7 ? " With under 7 days of history, gains are scaled to a week, capped at the repo's stars, and marked as estimated." : ''}`
      : 'Momentum is estimated from stars per day since creation (under three days of star history so far).');
    // Hosted: the Worker says how its own limits work instead of the local token hint.
    if (limitNote) notes.push(limitNote);
    else if (!github.hasToken) notes.push('No GITHUB_TOKEN set: GitHub allows 10 searches per minute; set one to raise it to 30.');
    return notes;
  }

  function enrichAndScore(rawItems, opts) {
    return scoreRepos(rawItems.map(normalizeRepo), opts);
  }

  // gains: optional Map fullName -> { gained, estimated } that replaces the
  // history lookup (the rising list carries its own, fresher gains).
  async function scoreRepos(repos, { withDownloads, gains = null }) {
    const packagesByRepo = await Promise.all(repos.map(async (repo) => {
      if (!withDownloads) return [];
      try { return await resolvePackages(repo, { cache: registryCache, now: now() }); } catch { return []; }
    }));
    return repos.map((repo, i) => {
      const packages = packagesByRepo[i];
      const known = packages.filter((p) => typeof p.weeklyDownloads === 'number');
      const weeklyDownloads = known.length ? known.reduce((s, p) => s + p.weeklyDownloads, 0) : null;
      const downloadsTrend = combinedTrend(packages);
      const given = gains?.get(repo.fullName);
      const starsGained7d = given ? given.gained : history.starsGained7d(repo.fullName);
      const starsGainedEstimated = starsGained7d !== null && (given ? Boolean(given.estimated) : Boolean(history.starsGainedEstimated?.(repo.fullName)));
      const s = scoreLib.scoreRepo({ ...repo, weeklyDownloads }, { starsGained7d, downloadsTrend, now: now() });
      return { ...repo, packages, weeklyDownloads, downloadsTrend, starsGained7d, starsGainedEstimated, score: s.score, tier: s.tier, verdict: s.verdict, parts: s.parts, flags: s.flags };
    });
  }

  const byScore = (a, b) => b.score - a.score || b.stars - a.stars;

  // Repos of any age by stars gained this week, from the daily rising list:
  // one download, no GitHub search. Languages without their own list filter
  // the overall top 100.
  async function rising({ language, limit, withDownloads }) {
    if (!loadRising) throw new Error('The rising list is not available in this build.');
    const n = Math.min(Math.max(Number(limit) || 20, 1), 100);
    const data = await loadRising();
    const lists = data.lists ?? {};
    const key = language ? Object.keys(lists).find((k) => k.toLowerCase() === String(language).toLowerCase()) : 'all';
    const list = key ? lists[key] : (lists.all ?? []).filter((r) => (r.language ?? '').toLowerCase() === String(language).toLowerCase());
    const top = list.slice(0, n);
    const gains = new Map(top.map((r) => [r.fullName, { gained: r.gained, estimated: r.estimated }]));
    const scored = await scoreRepos(top.map(({ gained, estimated, ...repo }) => repo), { withDownloads: Boolean(withDownloads), gains });
    scored.forEach((r, i) => { r.risingRank = i + 1; });
    scored.sort(byScore);
    const notes = [
      top.length || (data.spanDays ?? 0) >= 3
        ? `Rising ranks repos of any age by stars gained in the week to ${data.date}${data.estimated ? `, estimated from ${data.spanDays} days of daily star counts` : ''}. Tracked: the top 1,000 repos per language plus new trending repos, so smaller libraries are not in it.${language && !key ? ` ${language} has no list of its own; these are the ${language} repos in the overall top 100.` : ''}`
        : `Rising needs daily star counts covering at least 3 days; so far they cover ${data.spanDays ?? 0} (latest ${data.date ?? 'none'}). Try again in a few days, or use period "week".`,
      ...dataNotes().filter((note) => !note.startsWith('Momentum')),
    ];
    return {
      tool: 'trending_repos', period: 'rising', language, asOf: data.date, estimated: Boolean(data.estimated), totalMatches: list.length,
      generatedAt: new Date(now()).toISOString(), dataNotes: notes, repos: scored,
    };
  }

  return {
    async recommend({ need, language = null, limit = 5, includeCandidates = false } = {}) {
      const text = String(need ?? '').trim();
      if (text.length < 2) throw new ToolInputError('Describe the need in a few words, for example "python pdf parser".');
      const n = Math.min(Math.max(Number(limit) || 5, 1), 10);
      const { terms, topic } = expandNeed(text);
      const langs = languageQualifier(language);
      const query = [terms, langs, 'archived:false', 'fork:false', 'stars:>=20'].filter(Boolean).join(' ');
      const topicQuery = topic ? [`topic:${topic}`, langs, 'archived:false', 'fork:false'].filter(Boolean).join(' ') : null;
      // Three views: GitHub's relevance order finds the libraries that are actually about the
      // need; the stars order finds the big names whose description only mentions it; the
      // topic query finds what maintainers tagged themselves, which text search misses when
      // the vocabulary differs. Union all, then let fit decide.
      const [relevance, popular, tagged] = await Promise.all([
        github.searchRepos(query, { perPage: 25, sort: 'best-match' }),
        github.searchRepos(query, { perPage: 15, sort: 'stars' }),
        topicQuery ? github.searchRepos(topicQuery, { perPage: 20, sort: 'stars' }) : Promise.resolve({ items: [], totalCount: 0 }),
      ]);
      const sources = new Map();
      const addSource = (items, tag) => { for (const it of items) sources.set(it.full_name, [...(sources.get(it.full_name) ?? []), tag]); };
      addSource(relevance.items, 'relevance'); addSource(popular.items, 'stars'); addSource(tagged.items, 'topic');
      const seen = new Set();
      const candidates = [...relevance.items, ...popular.items, ...tagged.items].filter((it) => !seen.has(it.full_name) && seen.add(it.full_name));
      const relevanceRank = new Map(relevance.items.map((it, i) => [it.full_name, i + 1]));
      // The score measures health and popularity, not fit to the need. GitHub's relevance
      // order is the best fit signal available, so the ranking key is fit = score x relevance.
      const wantsLibrary = asksForLibrary(text);
      const withFit = (r) => {
        const rank = relevanceRank.get(r.fullName) ?? null;
        const src = sources.get(r.fullName) ?? [];
        let relevance = rank !== null ? 1 - RELEVANCE_DECAY * (rank - 1) / Math.max(1, RELEVANCE_WINDOW - 1)
          : src.includes('topic') ? RELEVANCE_TOPIC : RELEVANCE_ABSENT;
        const signals = { mention: mentionLevel(r, text), looksLikeLibrary: looksLikeLibrary(r) };
        relevance *= MENTION_FACTOR[signals.mention];
        if (wantsLibrary && !signals.looksLikeLibrary) relevance *= NOT_LIBRARY_FACTOR;
        return { ...r, relevanceRank: rank, sources: src, signals, relevance: Number(relevance.toFixed(3)), fit: Math.round(r.score * relevance) };
      };
      const byFit = (a, b) => b.fit - a.fit || byScore(a, b);
      // Cheap pass without registry lookups to pick the shortlist, then the full pass with downloads.
      const prelim = (await enrichAndScore(candidates, { withDownloads: false })).map(withFit).sort(byFit);
      const shortlist = prelim.slice(0, Math.max(2 * n, 8)).map((r) => candidates.find((it) => it.full_name === r.fullName));
      const scored = (await enrichAndScore(shortlist, { withDownloads: true })).map(withFit).sort(byFit).slice(0, n);
      const result = {
        tool: 'recommend_repos', need: text, language, query, topicQuery, totalMatches: relevance.totalCount,
        candidatesConsidered: candidates.length, shortlisted: shortlist.length,
        ranking: 'fit = score x relevance; relevance is 1.0 for GitHub relevance rank 1, 0.5 at rank 25, 0.75 when found only through the topic query, 0.4 when found only in the stars-sorted results; x0.75 when the repo names the subject only in its topic tags and x0.5 when nowhere in its name, description or topics; x0.8 when you asked for a framework/library and the repo reads like an application',
        generatedAt: new Date(now()).toISOString(), dataNotes: dataNotes(), repos: scored,
      };
      // For the eval: every candidate with its pre-download score, so baselines can be computed from the same pool.
      if (includeCandidates) result.candidates = prelim.map(({ fullName, description, topics, language: lang, stars, score, fit, relevance, relevanceRank, sources: src, signals }) => ({ fullName, description, topics, language: lang, stars, score, fit, relevance, relevanceRank, sources: src, signals }));
      return result;
    },

    async compare({ repos } = {}) {
      const names = Array.isArray(repos) ? repos.map((r) => String(r).trim()) : [];
      if (names.length < 2 || names.length > 10) throw new ToolInputError('Give between two and ten repositories to compare.');
      const bad = names.find((n) => !REPO_NAME.test(n));
      if (bad) throw new ToolInputError(`"${bad}" is not an owner/repo name. Use the form owner/repo, for example colinhacks/zod.`);
      // One misspelled or deleted repo should not sink the whole comparison:
      // compare the rest and say which ones could not be fetched.
      const fetched = await Promise.all(names.map(async (name) => {
        try { return { name, item: await github.getRepo(name) }; } catch (err) {
          // A rejected token or an exhausted limit is not "this repo is missing": fail the call.
          if (err instanceof GitHubRateLimitError || err instanceof GitHubAuthError) throw err;
          return { name, error: err.message };
        }
      }));
      const notFound = fetched.filter((f) => f.error).map((f) => ({ repo: f.name, error: f.error }));
      if (notFound.length === names.length) {
        throw new Error(`Could not fetch any of the repositories: ${notFound.map((f) => `${f.repo} (${f.error})`).join('; ')}`);
      }
      const scored = (await enrichAndScore(fetched.filter((f) => f.item).map((f) => f.item), { withDownloads: true })).sort(byScore);
      return { tool: 'compare_repos', requested: names, generatedAt: new Date(now()).toISOString(), dataNotes: dataNotes(), repos: scored, notFound };
    },

    async trending({ period = 'week', language = null, limit = 20, withDownloads = false } = {}) {
      if (period === 'rising') return rising({ language, limit, withDownloads });
      if (!PERIODS.includes(period)) throw new ToolInputError(`period must be one of ${[...PERIODS, 'rising'].join(', ')}.`);
      const n = Math.min(Math.max(Number(limit) || 20, 1), 100);
      const query = buildSearchQuery({ period, language, now: new Date(now()) });
      const { items, totalCount } = await github.searchRepos(query, { perPage: Math.min(Math.max(n, 30), 100), sort: 'stars' });
      const top = items.slice(0, n);
      const scored = await enrichAndScore(top, { withDownloads: Boolean(withDownloads) });
      scored.forEach((r, i) => { r.starsRank = i + 1; });
      scored.sort(byScore);
      return {
        tool: 'trending_repos', period, language, query, totalMatches: totalCount,
        generatedAt: new Date(now()).toISOString(), dataNotes: dataNotes(), repos: scored,
      };
    },
  };
}

const nf = new Intl.NumberFormat('en-US');
const compact = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1).replace(/\.0$/, '')}k` : String(n));

/** Plain-text rendering of a tool result for clients that only show text. */
export function formatResult(result) {
  const lines = [];
  if (result.tool === 'recommend_repos') lines.push(`Recommendations for "${result.need}"${result.language ? ` (${result.language})` : ''}: top ${result.repos.length} of ${result.candidatesConsidered} candidates, ${nf.format(result.totalMatches)} matches on GitHub.`);
  else if (result.tool === 'compare_repos') lines.push(`Comparison of ${result.repos.length} repositories, best first.`);
  else if (result.period === 'rising') lines.push(`Rising: ${result.repos.length} repos of any age with the most stars gained in the week to ${result.asOf ?? 'n/a'}${result.estimated ? ' (estimated)' : ''}${result.language ? ` in ${result.language}` : ''}, scored.`);
  else lines.push(`Most-starred repositories created in the last ${{ day: '24 hours', week: '7 days', month: '30 days' }[result.period]}${result.language ? ` in ${result.language}` : ''}, scored. ${nf.format(result.totalMatches)} repos created in the period.`);
  lines.push('');
  result.repos.forEach((r, i) => {
    const bits = [
      `★ ${nf.format(r.stars)}${gainText(r)}`,
      typeof r.weeklyDownloads === 'number' ? `${compact(r.weeklyDownloads)} downloads/wk${typeof r.downloadsTrend === 'number' ? ` (trend ${r.downloadsTrend >= 1 ? '+' : ''}${Math.round((r.downloadsTrend - 1) * 100)}%)` : ''}` : null,
      r.language, r.license ? r.license.toUpperCase() : 'no license',
    ].filter(Boolean).join(' · ');
    const head = typeof r.fit === 'number'
      ? `fit ${r.fit} (${r.tier} ${r.score}, relevance ${r.relevanceRank !== null ? `#${r.relevanceRank}` : r.sources?.includes('topic') ? 'topic' : 'stars-only'})`
      : `${r.tier} ${r.score}`;
    lines.push(`${i + 1}. ${r.fullName} — ${head} — ${bits}`);
    if (r.description) lines.push(`   ${r.description.length > 140 ? `${r.description.slice(0, 137)}...` : r.description}`);
    lines.push(`   ${r.verdict} ${r.url}`);
  });
  if (result.notFound?.length) { lines.push(''); for (const f of result.notFound) lines.push(`Could not fetch ${f.repo}: ${f.error}`); }
  if (result.dataNotes?.length) { lines.push(''); for (const n of result.dataNotes) lines.push(`Note: ${n}`); }
  return lines.join('\n');
}
