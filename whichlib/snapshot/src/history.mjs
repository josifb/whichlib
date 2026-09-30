// Turns the daily snapshot files into per-repo star series so momentum can
// use real stars-gained figures instead of the stars-per-day fallback.

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Read every data/snapshots/*.json, sorted by date. */
export async function loadSnapshots(dir) {
  const names = (await readdir(dir)).filter((n) => /^\d{4}-\d{2}-\d{2}\.json$/.test(n)).sort();
  const out = [];
  for (const name of names) out.push(JSON.parse(await readFile(join(dir, name), 'utf8')));
  return out;
}

/** Read every <date>.json stars file ({ date, stars: { fullName: n } }), sorted by date. */
export async function loadStarsFiles(dir) {
  const names = (await readdir(dir)).filter((n) => /^\d{4}-\d{2}-\d{2}\.json$/.test(n)).sort();
  const out = [];
  for (const name of names) out.push(JSON.parse(await readFile(join(dir, name), 'utf8')));
  return out;
}

export { buildHistory, starsGained, latestRepos, historyFromStars, weeklyGain, isWeeklyEstimate } from './history-core.mjs';
