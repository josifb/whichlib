#!/usr/bin/env node
// Prints the top repos from the latest snapshot by score, for eyeballing.
// Usage: node snapshot/src/score-report.mjs [limit]

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSnapshots, buildHistory, starsGained, latestRepos } from './history.mjs';
import scoreLib from '../../lib/score.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SNAP_DIR = join(ROOT, 'data', 'snapshots');

const limit = Number(process.argv[2]) || 25;
const snapshots = await loadSnapshots(SNAP_DIR);
if (snapshots.length === 0) {
  console.error('No snapshots found. Run `npm run snapshot` first.');
  process.exit(1);
}
const latest = snapshots.at(-1);
const history = buildHistory(snapshots);
const now = Date.parse(latest.fetchedAt);

const scored = latestRepos(snapshots)
  .map((repo) => {
    const gained = starsGained(history.get(repo.fullName), 7, latest.date);
    return { repo, gained, ...scoreLib.scoreRepo(repo, { starsGained7d: gained, now }) };
  })
  .sort((a, b) => b.score - a.score || b.repo.stars - a.repo.stars)
  .slice(0, limit);

const withHistory = scored.filter((s) => s.gained !== null).length;
console.log(`Snapshot ${latest.date} | ${snapshots.length} day(s) of history | ${withHistory}/${scored.length} shown repos have 7-day history\n`);
console.log(['Score', 'Tier'.padEnd(9), 'Stars'.padStart(7), '+7d'.padStart(6), 'Repository'.padEnd(44), 'Verdict'].join('  '));
for (const s of scored) {
  console.log([
    String(s.score).padStart(5),
    s.tier.padEnd(9),
    String(s.repo.stars).padStart(7),
    (s.gained === null ? '-' : String(s.gained)).padStart(6),
    s.repo.fullName.slice(0, 44).padEnd(44),
    s.verdict,
  ].join('  '));
}
