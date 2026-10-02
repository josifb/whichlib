import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTools, formatResult, ToolInputError } from '../tools.mjs';
import { GitHubRateLimitError, GitHubAuthError } from '../../snapshot/src/github.mjs';

const NOW = Date.parse('2026-09-27T12:00:00Z');
const daysAgo = (d) => new Date(NOW - d * 86400000).toISOString();

/** Raw GitHub API repo item, as the Search and Repos endpoints return it. */
function rawItem(fullName, stars, extra = {}) {
  return {
    full_name: fullName, html_url: `https://github.com/${fullName}`, description: `${fullName} does things`,
    language: 'TypeScript', stargazers_count: stars, forks_count: Math.round(stars / 10), open_issues_count: 3,
    license: { key: 'mit', spdx_id: 'MIT' }, created_at: daysAgo(400), pushed_at: daysAgo(2), archived: false, topics: ['x'],
    ...extra,
  };
}

function fakes({ items = [], relevanceItems = null, topicItems = [], repos = {}, gained = {}, downloads = {}, trends = {}, judgeFit = null } = {}) {
  const calls = { search: [], getRepo: [], resolve: [] };
  const github = {
    hasToken: false,
    async searchRepos(query, opts) {
      calls.search.push({ query, opts });
      const list = query.startsWith('topic:') ? topicItems : opts?.sort === 'best-match' && relevanceItems ? relevanceItems : items;
      return { items: list, totalCount: list.length };
    },
    async getRepo(fullName) {
      calls.getRepo.push(fullName);
      if (!repos[fullName]) throw new Error(`GitHub request failed: 404 Not Found`);
      return repos[fullName];
    },
  };
  const resolvePackages = async (repo) => {
    calls.resolve.push(repo.fullName);
    const dl = downloads[repo.fullName];
    if (dl === undefined) return [];
    const pkg = { registry: 'npm', name: repo.fullName.split('/')[1], weeklyDownloads: dl };
    return [repo.fullName in trends ? { ...pkg, downloadsTrend: trends[repo.fullName] } : pkg];
  };
  const history = { days: Object.keys(gained).length ? 3 : 0, spanDays: Object.keys(gained).length ? 7 : 0, latestDate: '2026-09-27', starsGained7d: (n) => gained[n] ?? null };
  const tools = createTools({ github, resolvePackages, history, judgeFit, now: () => NOW });
  return { tools, calls };
}

test('recommend: text query has synonyms, quoted language and hygiene; relevance + stars + one topic search', async () => {
  const { tools, calls } = fakes({ items: [rawItem('a/one', 100)] });
  await tools.recommend({ need: 'pdf parser', language: 'C#', limit: 5 });
  assert.equal(calls.search.length, 3);
  const text = calls.search.filter((c) => !c.query.startsWith('topic:'));
  assert.equal(text.length, 2);
  for (const c of text) assert.equal(c.query, 'pdf OR pdfs parser language:"C#" archived:false fork:false stars:>=20');
  assert.deepEqual(text.map((c) => c.opts.sort).sort(), ['best-match', 'stars']);
  const topic = calls.search.find((c) => c.query.startsWith('topic:'));
  assert.equal(topic.query, 'topic:pdf language:"C#" archived:false fork:false');
  assert.equal(topic.opts.sort, 'stars');
});

test('recommend: JavaScript and TypeScript are one family; Python includes Jupyter', async () => {
  const { tools, calls } = fakes({ items: [rawItem('a/one', 100)] });
  await tools.recommend({ need: 'markdown parser', language: 'JavaScript' });
  assert.match(calls.search[0].query, /language:JavaScript language:TypeScript/);
  calls.search.length = 0;
  await tools.recommend({ need: 'orm', language: 'Python' });
  assert.match(calls.search[0].query, /language:Python language:"Jupyter Notebook"/);
  calls.search.length = 0;
  await tools.recommend({ need: 'orm', language: 'Rust' });
  assert.match(calls.search[0].query, /language:Rust archived/);
});

test('recommend: a repo found only through the topic query gets relevance 0.75 and sources ["topic"]', async () => {
  const tagged = rawItem('t/tagged', 3000, { description: 'A PDF parsing library' });
  const textOnly = rawItem('x/text', 3000, { description: 'Another PDF library' });
  const { tools } = fakes({ items: [textOnly], topicItems: [tagged] });
  const r = await tools.recommend({ need: 'pdf parser', limit: 5 });
  const t = r.repos.find((x) => x.fullName === 't/tagged');
  assert.deepEqual(t.sources, ['topic']);
  assert.equal(t.relevance, 0.75);
  assert.equal(t.relevanceRank, null);
  assert.deepEqual(r.repos.find((x) => x.fullName === 'x/text').sources, ['relevance', 'stars']);
  assert.equal(r.topicQuery, 'topic:pdf archived:false fork:false');
});

test('recommend: candidates from both searches are deduplicated; only the shortlist gets registry lookups', async () => {
  const many = Array.from({ length: 12 }, (_, i) => rawItem(`o/r${i}`, 1000 - i * 50));
  const { tools, calls } = fakes({ items: many });
  const r = await tools.recommend({ need: 'thing', limit: 2 });
  assert.equal(r.candidatesConsidered, 12, 'same 12 items returned by both text searches count once');
  assert.equal(r.shortlisted, 8, 'max(2*limit, 8)');
  assert.equal(calls.resolve.length, 8);
  assert.equal(r.repos.length, 2);
});

test('recommend: returns at most limit repos sorted by score, with downloads attached and breakdown present', async () => {
  const items = [
    rawItem('a/popular-but-stale', 50000, { pushed_at: daysAgo(400) }),
    rawItem('b/active', 8000, { pushed_at: daysAgo(1) }),
    rawItem('c/archived', 60000, { archived: true }),
    rawItem('d/small', 300),
  ];
  const { tools, calls } = fakes({ items, downloads: { 'b/active': 250000, 'a/popular-but-stale': 100 } });
  const r = await tools.recommend({ need: 'thing', limit: 3 });
  assert.equal(r.tool, 'recommend_repos');
  assert.equal(r.repos.length, 3);
  assert.equal(r.repos[0].fullName, 'b/active', 'active, downloaded repo wins');
  assert.equal(r.repos.at(-1).fullName === 'c/archived' || !r.repos.some((x) => x.fullName === 'c/archived'), true, 'archived repo is last or cut');
  for (let i = 1; i < r.repos.length; i += 1) assert.ok(r.repos[i - 1].score >= r.repos[i].score);
  const b = r.repos.find((x) => x.fullName === 'b/active');
  assert.equal(b.weeklyDownloads, 250000);
  assert.deepEqual(b.packages, [{ registry: 'npm', name: 'active', weeklyDownloads: 250000 }]);
  assert.deepEqual(Object.keys(b.parts).sort(), ['adoption', 'license', 'maintenance', 'momentum']);
  assert.match(b.verdict, /250k downloads\/wk/);
  assert.equal(calls.resolve.length, 4, 'all four candidates were enriched (max(2*limit, 8) >= 4)');
  assert.equal(r.candidatesConsidered, 4);
});

test('recommend: ranks by fit = score x relevance, so a huge repo that only matches by popularity loses to a relevant one', async () => {
  const relevant = rawItem('r/pdf-lib', 5000, { pushed_at: daysAgo(3), description: 'PDF parsing library' });          // relevance rank 1
  const giant = rawItem('g/knowledge-graph', 150000, { pushed_at: daysAgo(0.5), description: 'Knowledge graph library for code, docs and PDFs' }); // only in the stars list
  const { tools } = fakes({ items: [giant, relevant], relevanceItems: [relevant] });
  const r = await tools.recommend({ need: 'pdf parser', limit: 2 });
  assert.equal(r.repos[0].fullName, 'r/pdf-lib');
  assert.equal(r.repos[0].relevanceRank, 1);
  assert.equal(r.repos[0].relevance, 1);
  assert.equal(r.repos[0].fit, r.repos[0].score);
  const g = r.repos[1];
  assert.equal(g.fullName, 'g/knowledge-graph');
  assert.equal(g.relevanceRank, null);
  assert.equal(g.relevance, 0.4);
  assert.equal(g.fit, Math.round(g.score * 0.4));
  assert.ok(g.score > r.repos[0].score, 'the giant still has the higher raw score; fit is what reorders');
  assert.match(formatResult(r), /fit \d+ \((Strong|Solid|Watch|Avoid) \d+, relevance #1\)/);
  assert.match(formatResult(r), /relevance stars-only/);
});

test('recommend: rejects an empty need', async () => {
  const { tools } = fakes();
  await assert.rejects(tools.recommend({ need: '   ' }), /need/i);
});

test('compare: fetches each repo, ranks by score, and reports which repo could not be found', async () => {
  const repos = { 'a/one': rawItem('a/one', 100, { pushed_at: daysAgo(300) }), 'b/two': rawItem('b/two', 100, { pushed_at: daysAgo(1) }) };
  const { tools, calls } = fakes({ repos });
  const r = await tools.compare({ repos: ['a/one', 'b/two'] });
  assert.equal(r.tool, 'compare_repos');
  assert.deepEqual(calls.getRepo.sort(), ['a/one', 'b/two']);
  assert.deepEqual(r.repos.map((x) => x.fullName), ['b/two', 'a/one']);
});

test('compare: a repo that cannot be fetched is reported, the rest are still compared', async () => {
  const repos = { 'a/one': rawItem('a/one', 100), 'b/two': rawItem('b/two', 200) };
  const { tools } = fakes({ repos });
  const r = await tools.compare({ repos: ['a/one', 'zz/missing', 'b/two'] });
  assert.deepEqual(r.repos.map((x) => x.fullName).sort(), ['a/one', 'b/two']);
  assert.deepEqual(r.notFound.map((x) => x.repo), ['zz/missing']);
  assert.match(r.notFound[0].error, /404/);
  assert.match(formatResult(r), /Could not fetch zz\/missing/);
});

test('compare: fails only when no repo at all can be fetched', async () => {
  const { tools } = fakes({ repos: {} });
  await assert.rejects(tools.compare({ repos: ['x/one', 'y/two'] }), /could not fetch any.*x\/one.*y\/two/i);
});

test('compare: validates count and name shape', async () => {
  const { tools } = fakes();
  await assert.rejects(tools.compare({ repos: ['only/one'] }), /two/i);
  await assert.rejects(tools.compare({ repos: ['bad name', 'b/two'] }), /owner\/repo/);
  await assert.rejects(tools.compare({ repos: ['https://github.com/a/b', 'b/two'] }), /owner\/repo/);
  await assert.rejects(tools.compare({ repos: ['a/..', 'b/two'] }), /owner\/repo/);
  await assert.rejects(tools.compare({ repos: ['a/.', 'b/two'] }), /owner\/repo/);
});

test('trending: period query, history-backed momentum, no registry lookups unless asked', async () => {
  const items = [rawItem('a/one', 900, { created_at: daysAgo(5) }), rawItem('b/two', 400, { created_at: daysAgo(3) })];
  const { tools, calls } = fakes({ items, gained: { 'a/one': 600 } });
  const r = await tools.trending({ period: 'week', language: 'Python', limit: 2 });
  assert.equal(r.tool, 'trending_repos');
  assert.match(calls.search[0].query, /^created:>=2026-09-20T12:00:00Z language:Python$/);
  assert.equal(calls.resolve.length, 0);
  const a = r.repos.find((x) => x.fullName === 'a/one');
  assert.equal(a.starsGained7d, 600);
  assert.equal(a.starsRank, 1);
  assert.equal(r.repos.find((x) => x.fullName === 'b/two').starsGained7d, null);
  assert.match(r.dataNotes.join(' '), /3 day/);
});

test('trending: withDownloads triggers registry lookups; bad period rejected', async () => {
  const { tools, calls } = fakes({ items: [rawItem('a/one', 10)] });
  await tools.trending({ period: 'day', withDownloads: true, limit: 1 });
  assert.equal(calls.resolve.length, 1);
  await assert.rejects(tools.trending({ period: 'year' }), /period/i);
});

test('formatResult: readable text with tier, score, stars and verdict per repo', async () => {
  const { tools } = fakes({ items: [rawItem('a/one', 12345)] });
  const text = formatResult(await tools.trending({ period: 'month', limit: 1 }));
  assert.match(text, /a\/one/);
  assert.match(text, /\b(Strong|Solid|Watch|Avoid)\b \d{1,3}\b/);
  assert.match(text, /12,345/);
  assert.match(text, /https:\/\/github\.com\/a\/one/);
});

test('recommend: a candidate that never mentions the need is halved; an application is x0.8 when a library was asked for', async () => {
  const lib = rawItem('p/click', 3000, { description: 'Composable command line interface toolkit' });
  const app = rawItem('y/downloader', 3000, { description: 'A feature-rich command-line video downloader' });
  const silent = rawItem('s/sherlock', 3000, { description: 'Hunt down social media accounts by username' });
  const { tools } = fakes({ items: [], topicItems: [lib, app, silent] });
  const r = await tools.recommend({ need: 'cli framework', limit: 3 });
  const by = Object.fromEntries(r.repos.map((x) => [x.fullName, x]));
  assert.deepEqual(r.repos.map((x) => x.fullName), ['p/click', 'y/downloader', 's/sherlock']);
  assert.equal(by['p/click'].relevance, 0.75);
  assert.deepEqual(by['p/click'].signals, { mention: 'text', looksLikeLibrary: true });
  assert.equal(by['y/downloader'].relevance, 0.6);
  assert.deepEqual(by['y/downloader'].signals, { mention: 'text', looksLikeLibrary: false });
  assert.equal(by['s/sherlock'].relevance, 0.3);
});

test('recommend: a topic-only candidate that names the subject only in its tags is x0.75 on top of the topic factor', async () => {
  const tagged = rawItem('r/vision-tools', 3000, { description: 'Reusable computer vision tools', topics: ['image-processing'] });
  const named = rawItem('p/pillow', 3000, { description: 'Python Imaging Library', topics: ['image-processing'] });
  const { tools } = fakes({ items: [], topicItems: [tagged, named] });
  const r = await tools.recommend({ need: 'image processing', limit: 2 });
  const by = Object.fromEntries(r.repos.map((x) => [x.fullName, x]));
  assert.equal(by['p/pillow'].relevance, 0.75);
  assert.equal(by['r/vision-tools'].relevance, 0.563);
  assert.equal(r.repos[0].fullName, 'p/pillow');
});

test('formatResult: labels the relevance source as #rank, topic or stars-only', async () => {
  const ranked = rawItem('a/ranked', 100, { description: 'PDF parsing library' });
  const tagged = rawItem('b/tagged', 100, { description: 'PDF parsing library' });
  const popular = rawItem('c/popular', 100, { description: 'PDF parsing library' });
  const { tools } = fakes({ relevanceItems: [ranked], items: [popular], topicItems: [tagged] });
  const text = formatResult(await tools.recommend({ need: 'pdf parser', limit: 3 }));
  assert.match(text, /a\/ranked — fit \d+ \(\w+ \d+, relevance #1\)/);
  assert.match(text, /b\/tagged — fit \d+ \(\w+ \d+, relevance topic\)/);
  assert.match(text, /c\/popular — fit \d+ \(\w+ \d+, relevance stars-only\)/);
});

test('compare: download trend is returned, shown, and lifts momentum when there is no star history', async () => {
  const repos = { 'a/rising': rawItem('a/rising', 5000), 'b/flat': rawItem('b/flat', 5000) };
  const { tools } = fakes({ repos, downloads: { 'a/rising': 50000, 'b/flat': 50000 }, trends: { 'a/rising': 1.5, 'b/flat': null } });
  const r = await tools.compare({ repos: ['a/rising', 'b/flat'] });
  const rising = r.repos.find((x) => x.fullName === 'a/rising');
  const flat = r.repos.find((x) => x.fullName === 'b/flat');
  assert.equal(rising.downloadsTrend, 1.5);
  assert.equal(flat.downloadsTrend, null);
  assert.ok(rising.parts.momentum > flat.parts.momentum);
  assert.match(formatResult(r), /50k downloads\/wk \(trend \+50%\)/);
});

test('compare: with several packages the trend is weighted by downloads', async () => {
  const repos = { 'a/multi': rawItem('a/multi', 5000), 'b/other': rawItem('b/other', 5000) };
  const tools = createTools({
    github: { hasToken: true, getRepo: async (n) => repos[n] },
    resolvePackages: async (repo) => (repo.fullName !== 'a/multi' ? [] : [
      { registry: 'npm', name: 'x', weeklyDownloads: 30000, downloadsTrend: 1.5 }, // baseline 20000
      { registry: 'npm', name: 'y', weeklyDownloads: 10000, downloadsTrend: 0.5 }, // baseline 20000
      { registry: 'npm', name: 'z', weeklyDownloads: 999, downloadsTrend: null }, // no trend: left out
    ]),
    history: { days: 0, spanDays: 0, latestDate: null, starsGained7d: () => null },
    now: () => NOW,
  });
  const r = await tools.compare({ repos: ['a/multi', 'b/other'] });
  assert.equal(r.repos.find((x) => x.fullName === 'a/multi').downloadsTrend, 1); // 40000 / 40000
});

test('format: measured gains read "in 7d", scaled ones are marked as estimates', async () => {
  const repos = { 'a/measured': rawItem('a/measured', 900), 'b/scaled': rawItem('b/scaled', 800) };
  const tools = createTools({
    github: { hasToken: true, getRepo: async (n) => repos[n] },
    resolvePackages: async () => [],
    history: {
      days: 4, spanDays: 3, latestDate: '2026-09-27',
      starsGained7d: (n) => ({ 'a/measured': 70, 'b/scaled': 210 })[n],
      starsGainedEstimated: (n) => n === 'b/scaled',
    },
    now: () => NOW,
  });
  const r = await tools.compare({ repos: ['a/measured', 'b/scaled'] });
  assert.equal(r.repos.find((x) => x.fullName === 'b/scaled').starsGainedEstimated, true);
  const text = formatResult(r);
  assert.match(text, /★ 900 \(\+70 in 7d\)/);
  assert.match(text, /★ 800 \(~\+210\/wk, estimated\)/);
});

const risingRepo = (fullName, language, stars, gained, estimated = false) => ({
  fullName, url: `https://github.com/${fullName}`, description: `${fullName} does things`, language, stars, forks: 10, openIssues: 1,
  license: 'mit', createdAt: daysAgo(2000), pushedAt: daysAgo(3), archived: false, topics: [], gained, estimated,
});
const risingData = {
  date: '2026-10-05', days: 8, spanDays: 7, estimated: false,
  lists: {
    all: [risingRepo('big/lib', 'Python', 90000, 5000), risingRepo('mid/lib', 'Go', 20000, 800), risingRepo('small/lib', 'Kotlin', 12000, 300)],
    Python: [risingRepo('big/lib', 'Python', 90000, 5000)],
  },
};

function risingTools(data, calls = { search: 0, load: 0 }) {
  const github = { hasToken: true, async searchRepos() { calls.search += 1; return { items: [], totalCount: 0 }; } };
  const history = { days: 0, spanDays: 0, latestDate: null, starsGained7d: () => null };
  const loadRising = async () => { calls.load += 1; return data; };
  return createTools({ github, resolvePackages: async () => [], history, loadRising, now: () => NOW });
}

test('trending rising: uses the rising list, no GitHub search, gains feed momentum', async () => {
  const calls = { search: 0, load: 0 };
  const r = await risingTools(risingData, calls).trending({ period: 'rising', limit: 2 });
  assert.equal(calls.search, 0);
  assert.equal(r.period, 'rising');
  assert.equal(r.asOf, '2026-10-05');
  assert.deepEqual(r.repos.map((x) => x.risingRank).sort(), [1, 2]);
  const big = r.repos.find((x) => x.fullName === 'big/lib');
  assert.equal(big.starsGained7d, 5000);
  assert.equal(big.parts.momentum, 1); // 5000 a week is the momentum max
  assert.match(formatResult(r), /Rising/);
  assert.match(formatResult(r), /\+5,000 in 7d/);
});

test('trending rising: language uses its own list, else filters the overall list, case-insensitive', async () => {
  const tools = risingTools(risingData);
  assert.deepEqual((await tools.trending({ period: 'rising', language: 'python' })).repos.map((x) => x.fullName), ['big/lib']);
  assert.deepEqual((await tools.trending({ period: 'rising', language: 'Kotlin' })).repos.map((x) => x.fullName), ['small/lib']);
});

test('trending rising: estimated gains are passed through and labelled', async () => {
  const data = { ...risingData, spanDays: 4, estimated: true, lists: { all: [risingRepo('big/lib', 'Python', 90000, 3000, true)] } };
  const r = await risingTools(data).trending({ period: 'rising' });
  assert.equal(r.repos[0].starsGainedEstimated, true);
  assert.match(formatResult(r), /~\+3,000\/wk, estimated/);
});

test('trending rising: too little history gives an empty list with a note, not an error', async () => {
  const data = { date: '2026-09-29', days: 3, spanDays: 2, estimated: false, lists: { all: [] } };
  const r = await risingTools(data).trending({ period: 'rising' });
  assert.deepEqual(r.repos, []);
  assert.match(r.dataNotes.join(' '), /covering at least 3 days; so far they cover 2/);
});

function typedErrorTools(errorFor) {
  const repos = { 'a/one': rawItem('a/one', 100) };
  return createTools({
    github: { hasToken: true, getRepo: async (n) => { if (repos[n]) return repos[n]; throw errorFor(n); } },
    resolvePackages: async () => [],
    history: { days: 0, spanDays: 0, latestDate: null, starsGained7d: () => null },
    now: () => NOW,
  });
}

test('compare: a rate-limit error fails the whole call instead of "not found"', async () => {
  const tools = typedErrorTools(() => new GitHubRateLimitError('GitHub rate limit reached; it resets in about 1 minute.', 60));
  await assert.rejects(tools.compare({ repos: ['a/one', 'b/two'] }), (err) => err instanceof GitHubRateLimitError && err.resetSeconds === 60);
});

test('compare: an auth error fails the whole call', async () => {
  const tools = typedErrorTools(() => new GitHubAuthError('GitHub request failed: 401 Bad credentials'));
  await assert.rejects(tools.compare({ repos: ['a/one', 'b/two'] }), (err) => err instanceof GitHubAuthError);
});

test('compare: other errors (404) still go under notFound', async () => {
  const tools = typedErrorTools(() => new Error('GitHub request failed: 404 Not Found'));
  const r = await tools.compare({ repos: ['a/one', 'b/two'] });
  assert.deepEqual(r.notFound.map((f) => f.repo), ['b/two']);
});

test('input errors are ToolInputError; other failures are not', async () => {
  const { tools } = fakes(); // the existing helper returns { tools, calls }; with no repos every getRepo is a 404
  const calls = [
    () => tools.recommend({ need: 'x' }),
    () => tools.compare({ repos: ['a/b'] }),
    () => tools.compare({ repos: ['not a name', 'a/b'] }),
    () => tools.trending({ period: 'year' }),
  ];
  for (const call of calls) {
    const err = await call().catch((e) => e);
    assert.ok(err instanceof ToolInputError, err.message);
  }
  const all404 = await tools.compare({ repos: ['a/b', 'c/d'] }).catch((e) => e);
  assert.ok(!(all404 instanceof ToolInputError));
  assert.match(all404.message, /Could not fetch any/);
});

test('limitNote replaces the no-token note', async () => {
  const { tools: local } = fakes({ items: [rawItem('a/one', 100)] });
  assert.match((await local.recommend({ need: 'thing' })).dataNotes.join(' '), /No GITHUB_TOKEN set/);
  const hosted = createTools({
    github: { hasToken: true, searchRepos: async () => ({ items: [rawItem('a/one', 100)], totalCount: 1 }) },
    resolvePackages: async () => [],
    history: { days: 0, spanDays: 0, latestDate: null, starsGained7d: () => null },
    limitNote: 'Hosted: 50 free tool calls per day.',
    now: () => NOW,
  });
  const notes = (await hosted.recommend({ need: 'thing' })).dataNotes.join(' ');
  assert.match(notes, /Hosted: 50 free tool calls per day/);
  assert.doesNotMatch(notes, /GITHUB_TOKEN/);
});

/** A judgeFit fake: fixed probabilities per repo, records what it was asked. */
function fakeJudge(probabilities, { fail = false } = {}) {
  const asked = [];
  const judgeFit = async (need, language, repos) => {
    asked.push({ need, language, names: repos.map((r) => r.fullName) });
    if (fail) throw new Error('TypeSafe answered 529');
    return new Map(Object.entries(probabilities));
  };
  judgeFit.model = 'jev-test';
  return { judgeFit, asked };
}

test('recommend with judgeFit: whole pool judged once, relevance = GitHub position x Jev, word-match factors off', async () => {
  // app/thing is rank 1 and huge but Jev says it is not a pdf library; lib/good is rank 2.
  const items = [rawItem('app/thing', 50000, { description: 'A desktop app' }), rawItem('lib/good', 800, { description: 'nothing matching here' })];
  const { judgeFit, asked } = fakeJudge({ 'app/thing': 0.1, 'lib/good': 0.9 });
  const { tools } = fakes({ items, judgeFit });
  const r = await tools.recommend({ need: 'pdf parser', language: 'Python', limit: 2 });
  assert.equal(asked.length, 1);
  assert.deepEqual(asked[0], { need: 'pdf parser', language: 'Python', names: ['app/thing', 'lib/good'] });
  assert.equal(r.fitJudge, 'jev-test');
  assert.equal(r.repos[0].fullName, 'lib/good');
  const good = r.repos[0];
  // rank 2 of a 25 window: 1 - 0.5 * 1/24; no x0.5 for "never mentions pdf" because Jev replaced that rule
  assert.equal(good.relevance, Number(((1 - 0.5 / 24) * 0.9).toFixed(3)));
  assert.equal(good.signals.jevFit, 0.9);
  assert.match(r.ranking, /TypeSafe Jev/);
});

test('recommend with judgeFit: a returned repo under 0.5 gets flag weak-fit', async () => {
  const items = [rawItem('a/one', 1000), rawItem('b/two', 900)];
  const { judgeFit } = fakeJudge({ 'a/one': 0.95, 'b/two': 0.3 });
  const { tools } = fakes({ items, judgeFit });
  const r = await tools.recommend({ need: 'pdf parser', limit: 2 });
  const byName = Object.fromEntries(r.repos.map((x) => [x.fullName, x]));
  assert.ok(byName['b/two'].flags.includes('weak-fit'));
  assert.ok(!byName['a/one'].flags.includes('weak-fit'));
});

test('recommend with judgeFit: a repo missing from the answers counts as 0', async () => {
  const items = [rawItem('a/one', 1000), rawItem('b/two', 900)];
  const { judgeFit } = fakeJudge({ 'a/one': 0.9 });
  const { tools } = fakes({ items, judgeFit });
  const r = await tools.recommend({ need: 'pdf parser', limit: 2 });
  assert.equal(r.repos.find((x) => x.fullName === 'b/two').relevance, 0);
});

test('recommend with judgeFit: no candidate at 0.5 or more adds the no-strong-match note', async () => {
  const items = [rawItem('a/one', 1000)];
  const { judgeFit } = fakeJudge({ 'a/one': 0.2 });
  const { tools } = fakes({ items, judgeFit });
  const r = await tools.recommend({ need: 'pdf parser', limit: 2 });
  assert.ok(r.dataNotes.some((n) => n.startsWith('No candidate is clearly a library for this need')));
});

test('recommend with judgeFit: a failing judge falls back to the word-match rules and says so', async () => {
  const items = [rawItem('a/one', 1000, { description: 'pdf parser' }), rawItem('b/two', 900)];
  const { judgeFit } = fakeJudge({}, { fail: true });
  const withJudge = await fakes({ items, judgeFit }).tools.recommend({ need: 'pdf parser', limit: 2 });
  const without = await fakes({ items }).tools.recommend({ need: 'pdf parser', limit: 2 });
  assert.equal(withJudge.fitJudge, 'rules (judge unavailable)');
  assert.ok(withJudge.dataNotes.some((n) => n.startsWith('The fit judgment (TypeSafe Jev) was unavailable')));
  assert.deepEqual(withJudge.repos.map((x) => [x.fullName, x.fit]), without.repos.map((x) => [x.fullName, x.fit]));
  assert.deepEqual(withJudge.repos.map((x) => [x.fullName, x.signals]), without.repos.map((x) => [x.fullName, x.signals]));
  assert.equal(withJudge.ranking, without.ranking);
  assert.equal(without.fitJudge, 'rules');
});

test('recommend without judgeFit: unchanged, no jevFit signal, no weak-fit flag', async () => {
  const items = [rawItem('a/one', 1000)];
  const r = await fakes({ items }).tools.recommend({ need: 'pdf parser', limit: 1 });
  assert.equal(r.repos[0].signals.jevFit, undefined);
  assert.ok(!r.repos[0].flags.includes('weak-fit'));
});

test('recommend with judgeFit: a malformed answer (not a Map) falls back to the rules', async () => {
  const items = [rawItem('a/one', 1000)];
  const judgeFit = async () => ({ 'a/one': 0.9 });
  const r = await fakes({ items, judgeFit }).tools.recommend({ need: 'pdf parser', limit: 1 });
  assert.equal(r.fitJudge, 'rules (judge unavailable)');
  assert.equal(r.repos[0].signals.jevFit, undefined);
});

test('recommend with judgeFit: a NaN probability counts as 0 and the call succeeds', async () => {
  const items = [rawItem('a/one', 1000), rawItem('b/two', 900)];
  const judgeFit = async () => new Map([['a/one', 0.9], ['b/two', NaN]]);
  const r = await fakes({ items, judgeFit }).tools.recommend({ need: 'pdf parser', limit: 2 });
  assert.equal(r.repos.find((x) => x.fullName === 'b/two').relevance, 0);
  assert.ok(r.repos.find((x) => x.fullName === 'a/one').relevance > 0);
});

test('recommend with judgeFit: a candidate at 0.6 means no no-strong-match note', async () => {
  const items = [rawItem('a/one', 1000)];
  const { judgeFit } = fakeJudge({ 'a/one': 0.6 });
  const r = await fakes({ items, judgeFit }).tools.recommend({ need: 'pdf parser', limit: 2 });
  assert.ok(!r.dataNotes.some((n) => n.startsWith('No candidate is clearly a library for this need')));
});

test('recommend with judgeFit: judging the whole pool lets a low-ranked candidate reach the shortlist', async () => {
  const items = Array.from({ length: 10 }, (_, i) => rawItem(`o/r${i}`, 10000 - i * 500));
  const probabilities = Object.fromEntries(items.map((_, i) => [`o/r${i}`, i === 9 ? 0.95 : 0.05]));
  const { judgeFit } = fakeJudge(probabilities);
  const judged = await fakes({ items, judgeFit }).tools.recommend({ need: 'pdf parser', limit: 1 });
  const plain = await fakes({ items }).tools.recommend({ need: 'pdf parser', limit: 1 });
  assert.equal(judged.repos[0].fullName, 'o/r9');
  assert.notEqual(plain.repos[0].fullName, 'o/r9');
});
