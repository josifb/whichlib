#!/usr/bin/env node
// Nightly snapshot: for every period x language, fetch the top 100 repos
// created in the period (by stars) and write one JSON file for the day.
// Usage: node snapshot/src/run.mjs   (set GITHUB_TOKEN to go 3x faster)

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PERIODS, buildSearchQuery, searchUrl } from './query.mjs';
import { normalizeRepo } from './normalize.mjs';
import { fetchSearch, paceDelayMs } from './github.mjs';

export const LANGUAGES = [null, 'JavaScript', 'TypeScript', 'Python', 'Go', 'Rust', 'Java', 'C++', 'C#'];

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT_DIR = join(ROOT, 'data', 'snapshots');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function snapshotFileName(date) {
  return `${date.toISOString().slice(0, 10)}.json`;
}

async function main() {
  const token = process.env.GITHUB_TOKEN || null;
  const now = new Date();
  const results = [];
  const jobs = PERIODS.flatMap((period) => LANGUAGES.map((language) => ({ period, language })));

  console.log(`Snapshot ${now.toISOString()} | ${jobs.length} queries | token: ${token ? 'yes' : 'no'}`);

  for (const [i, { period, language }] of jobs.entries()) {
    const query = buildSearchQuery({ period, language, now });
    const { items, totalCount } = await fetchSearch(searchUrl(query), { token });
    results.push({ period, language, totalCount, items: items.map(normalizeRepo) });
    console.log(`  [${i + 1}/${jobs.length}] ${period.padEnd(5)} ${(language ?? 'all').padEnd(11)} ${items.length} repos of ${totalCount}`);
    if (i < jobs.length - 1) await sleep(paceDelayMs(Boolean(token)));
  }

  await mkdir(OUT_DIR, { recursive: true });
  const outPath = join(OUT_DIR, snapshotFileName(now));
  await writeFile(outPath, JSON.stringify({ date: now.toISOString().slice(0, 10), fetchedAt: now.toISOString(), results }, null, 1));
  console.log(`Wrote ${outPath}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
