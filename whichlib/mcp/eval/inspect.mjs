#!/usr/bin/env node
// Show the full candidate pool for one need: fit, score, relevance rank,
// sources and why a wanted repo did or did not make it.
// Usage: node mcp/eval/inspect.mjs "<need>" [language] [wanted/repo ...]

import { createGitHubClient } from '../github-api.mjs';
import { loadHistoryProvider } from '../data.mjs';
import { createTools } from '../tools.mjs';
import { resolvePackages } from '../../snapshot/src/registry.mjs';

const [need, language = null, ...want] = process.argv.slice(2);
if (!need) { console.error('usage: node mcp/eval/inspect.mjs "<need>" [language] [wanted/repo ...]'); process.exit(1); }

const tools = createTools({ github: createGitHubClient(), resolvePackages, history: (await loadHistoryProvider()).provider });
const r = await tools.recommend({ need, language: language || null, limit: 5, includeCandidates: true });
console.log(`need: ${need} | language: ${language ?? 'any'}\nquery: ${r.query}\ntopic query: ${r.topicQuery}\ncandidates: ${r.candidatesConsidered}\n`);
console.log(' fit score  rel  sources               repo                                        stars');
for (const c of r.candidates) {
  const mark = want.some((w) => w.toLowerCase() === c.fullName.toLowerCase()) ? ' <== wanted' : '';
  console.log(String(c.fit).padStart(4), String(c.score).padStart(5), String(c.relevanceRank ?? '-').padStart(4), c.sources.join('+').padEnd(21), c.fullName.padEnd(43), String(c.stars).padStart(7), mark);
}
for (const w of want) {
  if (!r.candidates.some((c) => c.fullName.toLowerCase() === w.toLowerCase())) console.log(`\nNOT IN POOL: ${w}`);
}
