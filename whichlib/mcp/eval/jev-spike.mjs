#!/usr/bin/env node
// Spike: does a TypeSafe Jev relevance judgment rank better than our word-match
// signals? Step 1 (live) runs every need through recommend_repos, asks Jev one
// Noul per candidate in the pool, and saves pools + answers to results/jev-<date>.json.
// Step 2 (offline) ranks each pool several ways and prints hit@k / MRR.
// Usage: GITHUB_TOKEN=... TYPESAFE_API_KEY=... node mcp/eval/jev-spike.mjs
//        node mcp/eval/jev-spike.mjs results/jev-<date>.json   (re-rank a saved run, no API calls)

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { firstHitRank, summarize, pct } from './metrics.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const CHUNK = 12; // candidates per Jev request
const MODEL = 'jev-latest';

const QUESTION = (key) => ({
  type: 'noul',
  instructions: `Is \`candidates.${key}\` a library or framework a developer would add as a dependency, whose main purpose is \`need\` (in \`language\` when one is given)?`,
  criteria: {
    true: 'An installable library or framework whose primary purpose is the need',
    false: 'An application, end-user tool, service, curated list, tutorial, example collection, or a library whose main purpose is something else',
  },
});

async function askJev(need, language, pool) {
  const out = new Map();
  let tokens = 0; let ms = 0;
  const chunks = [];
  for (let i = 0; i < pool.length; i += CHUNK) chunks.push(pool.slice(i, i + CHUNK));
  await Promise.all(chunks.map(async (chunk) => {
    const keys = chunk.map((_, i) => `c${i}`);
    const candidates = Object.fromEntries(chunk.map((c, i) => [keys[i], { name: c.fullName, description: c.description, topics: c.topics, language: c.language }]));
    const body = { model: MODEL, state: { need, language: language ?? 'any', candidates }, questions: Object.fromEntries(keys.map((k) => [k, QUESTION(k)])) };
    for (let attempt = 0; ; attempt += 1) {
      const t = Date.now();
      const res = await fetch('https://api.typesafe.ai/v1/systemone', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.TYPESAFE_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if ((res.status === 429 || res.status === 529) && attempt < 4) { await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt)); continue; }
      if (!res.ok) throw new Error(`TypeSafe ${res.status}: ${await res.text()}`);
      const j = await res.json();
      ms = Math.max(ms, Date.now() - t);
      tokens += (j.usage?.input_tokens ?? 0) + (j.usage?.output_tokens ?? 0);
      chunk.forEach((c, i) => out.set(c.fullName, j.answers[keys[i]].noul));
      break;
    }
  }));
  return { noul: Object.fromEntries(out), tokens, ms };
}

async function collect() {
  const { needs } = JSON.parse(await readFile(join(here, 'needs.json'), 'utf8'));
  const { createGitHubClient } = await import('../github-api.mjs');
  const { loadHistoryProvider } = await import('../data.mjs');
  const { createTools } = await import('../tools.mjs');
  const { resolvePackages } = await import('../../snapshot/src/registry.mjs');
  const github = createGitHubClient();
  const { provider: history, refreshed } = await loadHistoryProvider();
  await refreshed;
  const tools = createTools({ github, resolvePackages, history });
  const paceMs = github.hasToken ? 6500 : 19000;
  const runs = [];
  console.error(`Jev spike: ${needs.length} needs | token: ${github.hasToken ? 'yes' : 'no'} | history: ${history.days} day(s)`);
  for (const [i, item] of needs.entries()) {
    const r = await tools.recommend({ need: item.need, language: item.language ?? null, limit: 5, includeCandidates: true });
    const jev = await askJev(item.need, item.language, r.candidates);
    runs.push({ ...item, candidates: r.candidates, final: r.repos.map((x) => x.fullName), jev });
    console.error(`  [${i + 1}/${needs.length}] ${item.need} (${item.language ?? ''}): ${r.candidates.length} candidates, ${jev.tokens} tokens, ${jev.ms} ms`);
    if (i < needs.length - 1) await new Promise((res) => setTimeout(res, paceMs));
  }
  const date = new Date().toISOString().slice(0, 10);
  await mkdir(join(here, 'results'), { recursive: true });
  const path = join(here, 'results', `jev-${date}.json`);
  await writeFile(path, JSON.stringify({ date, model: MODEL, runs }, null, 1));
  console.error(`Wrote ${path}`);
  return { date, runs };
}

// GitHub position factor alone, as in tools.mjs, without the word-match signals.
const position = (c) => (c.relevanceRank !== null ? 1 - 0.5 * (c.relevanceRank - 1) / 24 : c.sources.includes('topic') ? 0.75 : 0.4);

const STRATEGIES = {
  fit: { label: 'fit today (pre-download)', key: (c) => c.fit },
  relevance: { label: 'GitHub relevance order', key: (c) => (c.relevanceRank === null ? -Infinity : -c.relevanceRank) },
  jevOnly: { label: 'Jev only', key: (c, p) => p },
  jevScore: { label: 'score x Jev', key: (c, p) => c.score * p },
  jevPosition: { label: 'score x GitHub position x Jev (Jev replaces word-match)', key: (c, p) => c.score * position(c) * p },
  fitTimesJev: { label: 'fit x Jev (Jev on top of everything)', key: (c, p) => c.fit * p },
  fitSoftJev: { label: 'fit x (0.5 + 0.5 Jev)', key: (c, p) => c.fit * (0.5 + 0.5 * p) },
  jevGate: { label: 'fit, Jev < 0.3 sent to the bottom', key: (c, p) => (p < 0.3 ? c.fit - 1e6 : c.fit) },
};

function report({ date, runs }) {
  const ranks = Object.fromEntries(Object.keys(STRATEGIES).map((k) => [k, []]));
  ranks.final = [];
  const rows = [];
  for (const run of runs) {
    ranks.final.push(firstHitRank(run.final, run.accept));
    const row = { need: `${run.need} (${run.language ?? ''})` };
    for (const [k, s] of Object.entries(STRATEGIES)) {
      const p = (c) => run.jev.noul[c.fullName] ?? 0;
      const names = [...run.candidates].sort((a, b) => s.key(b, p(b)) - s.key(a, p(a)) || b.score - a.score).slice(0, 5).map((c) => c.fullName);
      const r = firstHitRank(names, run.accept);
      ranks[k].push(r);
      row[k] = { r, top: names };
    }
    rows.push(row);
  }
  const tokens = runs.reduce((s, r) => s + r.jev.tokens, 0);
  const pool = runs.reduce((s, r) => s + r.candidates.length, 0);
  console.log(`# Jev spike ${date}\n\n${runs.length} needs, ${pool} candidates judged, ${tokens} tokens total.\n`);
  console.log('| Ranking | hit@1 | hit@3 | hit@5 | MRR |\n|---|---|---|---|---|');
  const labels = { final: 'tool output today (with downloads)', ...Object.fromEntries(Object.entries(STRATEGIES).map(([k, s]) => [k, s.label])) };
  for (const k of ['final', ...Object.keys(STRATEGIES)]) {
    const s = summarize(ranks[k]);
    console.log(`| ${labels[k]} | ${pct(s.hitAt1)} | ${pct(s.hitAt3)} | ${pct(s.hitAt5)} | ${s.mrr.toFixed(2)} |`);
  }
  console.log('\n| Need | fit | jevPosition | fitTimesJev | fit top 1 | jevPosition top 1 |\n|---|---|---|---|---|---|');
  for (const row of rows) console.log(`| ${row.need} | ${row.fit.r ?? '-'} | ${row.jevPosition.r ?? '-'} | ${row.fitTimesJev.r ?? '-'} | ${row.fit.top[0]} | ${row.jevPosition.top[0]} |`);
}

const saved = process.argv[2];
report(saved ? JSON.parse(await readFile(resolve(saved), 'utf8')) : await collect());
