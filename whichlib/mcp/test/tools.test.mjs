import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTools, formatResult } from '../tools.mjs';

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

function fakes({ items = [], relevanceItems = null, topicItems = [], repos = {}, gained = {}, downloads = {} } = {}) {
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
    return dl === undefined ? [] : [{ registry: 'npm', name: repo.fullName.split('/')[1], weeklyDownloads: dl }];
  };
  const history = { days: Object.keys(gained).length ? 3 : 0, latestDate: '2026-09-27', starsGained7d: (n) => gained[n] ?? null };
  const tools = createTools({ github, resolvePackages, history, now: () => NOW });
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
  assert.match(formatResult(r), /fit \d+ \((Strong|Promising|Watch|Avoid) \d+, relevance #1\)/);
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
  await assert.rejects(tools.compare({ repos: ['a/one', 'zz/missing'] }), /zz\/missing/);
});

test('compare: validates count and name shape', async () => {
  const { tools } = fakes();
  await assert.rejects(tools.compare({ repos: ['only/one'] }), /two/i);
  await assert.rejects(tools.compare({ repos: ['bad name', 'b/two'] }), /owner\/repo/);
  await assert.rejects(tools.compare({ repos: ['https://github.com/a/b', 'b/two'] }), /owner\/repo/);
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
  assert.match(text, /\b(Strong|Promising|Watch|Avoid)\b \d{1,3}\b/);
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
