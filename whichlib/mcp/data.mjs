// Star history for the MCP server, so momentum uses real 7-day stars gained.
// Sources, first match wins:
//   FRESH_REPOS_DATA_DIR       a folder of daily files (trending snapshots or stars files)
//   <clone>/data/stars         after `npm run pull-data` in a clone
//   <clone>/data/snapshots     older clones
//   ~/.whichlib/stars/         cache for npx users, refreshed in the background
//                              from the public `data` branch at most every 12 h
// WHICHLIB_HISTORY=off skips the download. With no history every lookup is
// null and the score falls back to stars per day since creation. Logs go to
// stderr only: stdout is the protocol channel.

import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { historyFromStars, weeklyGain, isWeeklyEstimate } from '../snapshot/src/history.mjs';
import { starsFromSnapshot } from '../snapshot/src/stars.mjs';

export const STARS_URL = 'https://raw.githubusercontent.com/josifb/whichlib/data/stars';
export const RISING_URL = 'https://raw.githubusercontent.com/josifb/whichlib/data/rising.json';
const RISING_TTL_MS = 3600_000;
const REFRESH_EVERY_MS = 12 * 3600_000;
const KEEP_DAYS = 10;
const DAY_MS = 86400000;
const STAMP = '.refreshed';
const DATE_FILE = /^(\d{4}-\d{2}-\d{2})\.json$/;
const REPO_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');

export const emptyHistory = { days: 0, spanDays: 0, latestDate: null, source: null, starsGained7d: () => null, starsGainedEstimated: () => false };

/** History values from stars files ({ date, stars }). */
export function buildProvider(files, source) {
  if (files.length === 0) return { ...emptyHistory, source };
  const sorted = [...files].sort((a, b) => a.date.localeCompare(b.date));
  const history = historyFromStars(sorted);
  const latestDate = sorted.at(-1).date;
  return {
    days: sorted.length,
    spanDays: (Date.parse(latestDate) - Date.parse(sorted[0].date)) / DAY_MS,
    latestDate,
    source,
    starsGained7d: (fullName) => weeklyGain(history.get(fullName), latestDate),
    starsGainedEstimated: (fullName) => isWeeklyEstimate(history.get(fullName), latestDate),
  };
}

/** Every <date>.json in dir as a stars file; trending snapshots are reduced to one. */
async function loadDayFiles(dir) {
  const names = (await readdir(dir)).filter((n) => DATE_FILE.test(n)).sort();
  const out = [];
  for (const name of names) {
    const data = JSON.parse(await readFile(join(dir, name), 'utf8'));
    out.push(Array.isArray(data.results) ? starsFromSnapshot(data) : data);
  }
  return out;
}

const isStarsFile = (f, date) => f && f.date === date && f.stars && typeof f.stars === 'object';
const isoDate = (ms) => new Date(ms).toISOString().slice(0, 10);

/**
 * Bring the cache up to date: fetch the last KEEP_DAYS dates missing locally
 * (404 = not published yet), prune older files. Skipped within 12 h of the
 * last successful refresh. Throws on network errors without writing the
 * timestamp, so the next start tries again.
 */
export async function refreshCache({ dir, now = Date.now(), fetchImpl = fetch }) {
  await mkdir(dir, { recursive: true });
  try {
    const last = Number(await readFile(join(dir, STAMP), 'utf8'));
    if (now - last < REFRESH_EVERY_MS) return { skipped: true, downloaded: 0, pruned: 0 };
  } catch { /* no timestamp yet */ }

  const oldest = isoDate(now - (KEEP_DAYS - 1) * DAY_MS);
  let pruned = 0;
  const have = new Set();
  for (const name of await readdir(dir)) {
    const date = DATE_FILE.exec(name)?.[1];
    if (!date) continue;
    if (date < oldest) { await rm(join(dir, name), { force: true }); pruned += 1; } else have.add(date);
  }

  let downloaded = 0;
  for (let i = 0; i < KEEP_DAYS; i += 1) {
    const date = isoDate(now - i * DAY_MS);
    if (have.has(date)) continue;
    const res = await fetchImpl(`${STARS_URL}/${date}.json`, { signal: AbortSignal.timeout(20_000) });
    if (res.status === 404) continue;
    if (!res.ok) throw new Error(`star history download failed: ${res.status}`);
    const data = await res.json();
    if (!isStarsFile(data, date)) continue;
    await writeFile(join(dir, `${date}.json`), JSON.stringify(data));
    downloaded += 1;
  }
  await writeFile(join(dir, STAMP), String(now));
  return { skipped: false, downloaded, pruned };
}

/**
 * The history provider, filled from the first local source at once. For the
 * cache, `refreshed` settles when the background refresh is done; the
 * provider is updated in place, so tools see the new history on later calls.
 */
export async function loadHistoryProvider({
  env = process.env, homeDir = homedir(), repoDir = REPO_DIR, now = Date.now(), fetchImpl = fetch,
  log = (m) => console.error(m),
} = {}) {
  const provider = { ...emptyHistory };
  const fill = async (dir, source) => {
    try { Object.assign(provider, buildProvider(await loadDayFiles(dir), source)); } catch { /* unreadable: keep what we have */ }
  };
  const done = Promise.resolve();

  if (env.FRESH_REPOS_DATA_DIR) { await fill(env.FRESH_REPOS_DATA_DIR, 'env'); return { provider, refreshed: done }; }
  for (const sub of ['stars', 'snapshots']) {
    const dir = join(repoDir, 'data', sub);
    if (existsSync(dir)) { await fill(dir, 'clone'); return { provider, refreshed: done }; }
  }

  const cacheDir = join(homeDir, '.whichlib', 'stars');
  if (existsSync(cacheDir)) await fill(cacheDir, 'cache');
  if (String(env.WHICHLIB_HISTORY).toLowerCase() === 'off') return { provider, refreshed: done };

  const refreshed = refreshCache({ dir: cacheDir, now, fetchImpl })
    .then(async (r) => {
      if (r.downloaded || r.pruned) {
        await fill(cacheDir, 'cache');
        log(`whichlib history: ${provider.days} day(s), latest ${provider.latestDate}`);
      }
    })
    .catch((err) => log(`whichlib history: refresh skipped (${err.message}); momentum uses what is cached`));
  return { provider, refreshed };
}

/**
 * Loader for the rising list (repos of any age by stars gained this week),
 * rebuilt daily by the snapshot job. One download per hour at most; only
 * called when an agent asks trending_repos for period "rising".
 */
export function createRisingLoader({ fetchImpl = fetch, now = Date.now } = {}) {
  let cached = null;
  let fetchedAt = 0;
  return async function loadRising() {
    if (cached && now() - fetchedAt < RISING_TTL_MS) return cached;
    const res = await fetchImpl(RISING_URL, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`Could not download the rising list: HTTP ${res.status}`);
    cached = await res.json();
    fetchedAt = now();
    return cached;
  };
}
