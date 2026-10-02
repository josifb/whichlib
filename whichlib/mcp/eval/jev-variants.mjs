#!/usr/bin/env node
// Spike, part 2: re-ask Jev about the pools saved by jev-spike.mjs with the layouts the
// TypeSafe docs recommend (each question sees only its own candidate, in its instructions;
// one judgment per Noul) and compare rankings. No GitHub calls.
// Usage: TYPESAFE_API_KEY=... node mcp/eval/jev-variants.mjs results/jev-<date>.json [...more]

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { firstHitRank, summarize, pct, norm } from './metrics.mjs';

const MODEL = 'jev-1.13.0';
const CHUNK = 20; // candidates per request (x2 questions)
const card = (c) => ({ name: c.fullName, description: c.description, topics: c.topics, language: c.language });
const QUESTIONS = {
  combined: (c) => ({ type: 'noul', instructions: { candidate: card(c), question: 'Is `candidate` a library or framework a developer would add as a dependency, whose main purpose is `need` (in `language` when one is given)?' },
    criteria: { true: 'An installable library or framework whose primary purpose is the need', false: 'An application, end-user tool, service, curated list, tutorial, example collection, or a library whose main purpose is something else' } }),
  library: (c) => ({ type: 'noul', instructions: { candidate: card(c), question: 'Is `candidate` a library or framework that developers add to their own code as a dependency?' },
    criteria: { true: 'A package imported or linked by other code: a library, framework, SDK or toolkit', false: 'An application, end-user tool, hosted service, curated list, tutorial, course or collection of examples' } }),
  purpose: (c) => ({ type: 'noul', instructions: { candidate: card(c), question: 'Is `need` the main purpose of `candidate`?' },
    criteria: { true: 'What the project mainly does is the need', false: 'The project does something else, or the need is only a side feature or a use case of it' } }),
};

async function ask(questions) {
  for (let attempt = 0; ; attempt += 1) {
    const res = await fetch('https://api.typesafe.ai/v1/systemone', {
      method: 'POST', headers: { Authorization: `Bearer ${process.env.TYPESAFE_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(questions),
    });
    if ((res.status === 429 || res.status >= 500) && attempt < 4) { await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt)); continue; }
    if (!res.ok) throw new Error(`TypeSafe ${res.status} ${res.headers.get('x-typesafe-request-id')}: ${await res.text()}`);
    return res.json();
  }
}

async function judge(run) {
  if (run.variants) return; // already asked
  const out = { combined: {}, library: {}, purpose: {} }; let tokens = 0;
  const chunks = [];
  for (let i = 0; i < run.candidates.length; i += CHUNK) chunks.push(run.candidates.slice(i, i + CHUNK));
  await Promise.all(chunks.map(async (chunk) => {
    const questions = {};
    chunk.forEach((c, i) => { for (const [k, q] of Object.entries(QUESTIONS)) questions[`${k}_${i}`] = q(c); });
    const j = await ask({ model: MODEL, state: { need: run.need, language: run.language ?? 'any' }, questions });
    tokens += j.usage.input_tokens;
    chunk.forEach((c, i) => { for (const k of Object.keys(QUESTIONS)) out[k][c.fullName] = j.answers[`${k}_${i}`].noul; });
  }));
  run.variants = { ...out, tokens };
}

const position = (c) => (c.relevanceRank !== null ? 1 - 0.5 * (c.relevanceRank - 1) / 24 : c.sources.includes('topic') ? 0.75 : 0.4);
const JUDGMENTS = {
  shared: (run, c) => run.jev.noul[c.fullName] ?? 0,
  combined: (run, c) => run.variants.combined[c.fullName],
  split: (run, c) => run.variants.library[c.fullName] * run.variants.purpose[c.fullName],
};
const BLENDS = { 'score x position x p': (c, p) => c.score * position(c) * p, 'fit x p': (c, p) => c.fit * p };

for (const file of process.argv.slice(2)) {
  const data = JSON.parse(await readFile(resolve(file), 'utf8'));
  for (const run of data.runs) await judge(run);
  await writeFile(resolve(file), JSON.stringify(data, null, 1));
  const tokens = data.runs.reduce((s, r) => s + r.variants.tokens, 0);
  const sharedTokens = data.runs.reduce((s, r) => s + r.jev.tokens, 0);
  console.log(`\n## ${data.needsFile ?? 'needs.json'} (${data.runs.length} needs)\n\nTokens: shared state ${sharedTokens} (1 question each); per-candidate ${tokens} (3 questions each, so ~${Math.round(tokens / 3)} per layout)\n`);
  console.log('| Judgment | Blend | hit@1 | hit@3 | hit@5 | MRR | accepted in top 5 | p<0.3 in top 5 |\n|---|---|---|---|---|---|---|---|');
  const fitRanks = data.runs.map((run) => firstHitRank([...run.candidates].sort((a, b) => b.fit - a.fit).slice(0, 5).map((c) => c.fullName), run.accept));
  const fitAcc = data.runs.reduce((s, run) => { const acc = new Set(run.accept.map(norm)); return s + [...run.candidates].sort((a, b) => b.fit - a.fit).slice(0, 5).filter((c) => acc.has(norm(c.fullName))).length; }, 0);
  const sf = summarize(fitRanks);
  console.log(`| none (fit today) | - | ${pct(sf.hitAt1)} | ${pct(sf.hitAt3)} | ${pct(sf.hitAt5)} | ${sf.mrr.toFixed(2)} | ${fitAcc} | - |`);
  for (const [jk, jf] of Object.entries(JUDGMENTS)) for (const [bk, bf] of Object.entries(BLENDS)) {
    const ranks = []; let acc5 = 0; let junk = 0;
    for (const run of data.runs) {
      const acc = new Set(run.accept.map(norm));
      const top = [...run.candidates].sort((a, b) => bf(b, jf(run, b)) - bf(a, jf(run, a)) || b.score - a.score).slice(0, 5);
      ranks.push(firstHitRank(top.map((c) => c.fullName), run.accept));
      acc5 += top.filter((c) => acc.has(norm(c.fullName))).length;
      junk += top.filter((c) => jf(run, c) < 0.3).length;
    }
    const s = summarize(ranks);
    console.log(`| ${jk} | ${bk} | ${pct(s.hitAt1)} | ${pct(s.hitAt3)} | ${pct(s.hitAt5)} | ${s.mrr.toFixed(2)} | ${acc5} | ${junk} |`);
  }
}
