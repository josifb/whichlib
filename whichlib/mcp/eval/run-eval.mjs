#!/usr/bin/env node
// Recommendation eval: run every need in needs.json through recommend_repos
// against the live APIs and measure how often an accepted repo appears at
// rank 1 / 3 / 5, for our ranking and for three baselines built from the
// same candidate pool. Writes a markdown report to eval/results/<date>.md.
// Usage: GITHUB_TOKEN=... node mcp/eval/run-eval.mjs   (token strongly advised: 40 searches)

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGitHubClient } from '../github-api.mjs';
import { loadHistoryProvider } from '../data.mjs';
import { createTools } from '../tools.mjs';
import { resolvePackages } from '../../snapshot/src/registry.mjs';
import { firstHitRank, summarize, pct, norm } from './metrics.mjs';
import { createJevJudge } from '../jev.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i === -1 ? null : args[i + 1] ?? true; };
const needsFile = flag('--needs') ?? 'needs.json';
if (typeof needsFile !== 'string') throw new Error('--needs takes a file name, e.g. --needs needs-niche.json');
const useJev = args.includes('--jev');
if (useJev && !process.env.TYPESAFE_API_KEY) throw new Error('--jev needs TYPESAFE_API_KEY');
const { needs } = JSON.parse(await readFile(join(here, needsFile), 'utf8'));
const github = createGitHubClient();
const { provider: history, refreshed } = await loadHistoryProvider();
await refreshed; // an eval must not race the background download
const judgeFit = useJev ? createJevJudge({ apiKey: process.env.TYPESAFE_API_KEY }) : null;
const tools = createTools({ github, resolvePackages, history, judgeFit });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const paceMs = github.hasToken ? 6500 : 19000; // 3 searches per need; 30/min with token, 10/min without

const STRATEGIES = {
  fit: (c) => [...c].sort((a, b) => b.fit - a.fit || b.score - a.score),
  scoreOnly: (c) => [...c].sort((a, b) => b.score - a.score || b.stars - a.stars),
  relevance: (c) => [...c].filter((x) => x.relevanceRank !== null).sort((a, b) => a.relevanceRank - b.relevanceRank),
  stars: (c) => [...c].sort((a, b) => b.stars - a.stars),
};

const ranks = Object.fromEntries(Object.keys(STRATEGIES).map((k) => [k, []]));
ranks.final = []; // the actual top-5 returned by the tool (fit ranking after downloads)
const rows = [];

console.error(`Eval: ${needs.length} needs | token: ${github.hasToken ? 'yes' : 'no'} | history: ${history.days} day(s)`);
for (const [i, item] of needs.entries()) {
  const started = Date.now();
  const r = await tools.recommend({ need: item.need, language: item.language ?? null, limit: 5, includeCandidates: true });
  if (useJev && r.fitJudge !== judgeFit.model) throw new Error(`Jev was unavailable for "${item.need}" (fitJudge: ${r.fitJudge}); rerun later`);
  const accept = new Set(item.accept.map(norm));
  const finalNames = r.repos.map((x) => x.fullName);
  const finalRank = firstHitRank(finalNames, item.accept);
  ranks.final.push(finalRank);
  const base = {};
  for (const [k, sortFn] of Object.entries(STRATEGIES)) {
    const names = sortFn(r.candidates).slice(0, 5).map((x) => x.fullName);
    const rank = firstHitRank(names, item.accept);
    ranks[k].push(rank);
    base[k] = rank;
  }
  const acceptedInPool = r.candidates.filter((c) => accept.has(norm(c.fullName))).map((c) => c.fullName);
  rows.push({ item, finalNames, finalRank, base, acceptedInPool, candidates: r.candidatesConsidered });
  console.error(`  [${i + 1}/${needs.length}] ${(item.language ?? '').padEnd(10)} ${item.need.padEnd(30)} first hit: ours=${finalRank ?? '-'} rel=${base.relevance ?? '-'} stars=${base.stars ?? '-'} score=${base.scoreOnly ?? '-'}  (${Date.now() - started} ms)`);
  if (i < needs.length - 1) await sleep(paceMs);
}

const date = new Date().toISOString().slice(0, 10);
const sums = Object.fromEntries(Object.entries(ranks).map(([k, v]) => [k, summarize(v)]));
const lines = [];
lines.push(`# Recommendation eval ${date}`, '');
lines.push(`${needs.length} needs (${needsFile}${useJev ? `, fit judge ${judgeFit.model}` : ''}), live GitHub + registry data, snapshot history: ${history.days} day(s). A hit is any repo in the need's accepted set. Baselines are computed from the same candidate pool (relevance top 25 ∪ stars top 15).`, '');
lines.push('| Ranking | hit@1 | hit@3 | hit@5 | MRR |', '|---|---|---|---|---|');
const label = { final: '**ours: fit, with downloads (what the tool returns)**', fit: 'fit, pre-download scores', scoreOnly: 'score only (no relevance)', relevance: 'GitHub relevance order', stars: 'stars order' };
for (const k of ['final', 'fit', 'scoreOnly', 'relevance', 'stars']) {
  const s = sums[k];
  lines.push(`| ${label[k]} | ${pct(s.hitAt1)} | ${pct(s.hitAt3)} | ${pct(s.hitAt5)} | ${s.mrr.toFixed(2)} |`);
}
lines.push('', '## Per need', '', '| Need | Lang | Ours top 5 (✓ = accepted) | First hit: ours / relevance / stars / score | Accepted repos in pool |', '|---|---|---|---|---|');
for (const row of rows) {
  const accept = new Set(row.item.accept.map(norm));
  const top = row.finalNames.map((n) => (accept.has(norm(n)) ? `✓ ${n}` : n)).join('<br>');
  lines.push(`| ${row.item.need} | ${row.item.language ?? ''} | ${top} | ${row.finalRank ?? '-'} / ${row.base.relevance ?? '-'} / ${row.base.stars ?? '-'} / ${row.base.scoreOnly ?? '-'} | ${row.acceptedInPool.length ? row.acceptedInPool.join('<br>') : 'none of ' + row.candidates} |`);
}
lines.push('', '## Reading it', '', '- "Accepted repos in pool" empty means GitHub search never surfaced an accepted answer among the candidates: a retrieval problem, not a ranking problem.', '- If relevance order beats ours, the score is pulling good answers down; if stars order beats ours, momentum/maintenance are penalising mature libraries.', '');

const outDir = join(here, 'results');
await mkdir(outDir, { recursive: true });
// Never overwrite an earlier run from the same day: <date>.md, then <date>-2.md, ...
const suffix = `${useJev ? '-jev' : ''}${needsFile === 'needs.json' ? '' : `-${needsFile.replace(/^needs-|\.json$/g, '')}`}`;
const base = `${date}${suffix}`;
let outPath = join(outDir, `${base}.md`);
for (let n = 2; existsSync(outPath); n += 1) outPath = join(outDir, `${base}-${n}.md`);
await writeFile(outPath, lines.join('\n'));
console.error(`\nWrote ${outPath}\n`);
console.log(lines.slice(0, 10).join('\n'));
