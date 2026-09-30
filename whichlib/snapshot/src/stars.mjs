#!/usr/bin/env node
// Daily star counts for momentum, compact enough for the MCP server to
// download: data/stars/<date>.json = { date, stars: { fullName: stars } }.
// Covers the all-time top 1,000 repos per language (GitHub search stops at
// 1,000 results per query) plus every repo in that day's trending snapshot,
// so mature libraries get real stars-gained figures too. Snapshot dates
// without a stars file are backfilled from the snapshot alone. Also writes
// data/rising.json: repos of any age ranked by stars gained this week.
// Usage: node snapshot/src/stars.mjs   (run after `npm run snapshot`; set GITHUB_TOKEN)

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { searchUrl } from './query.mjs';
import { fetchSearch, paceDelayMs } from './github.mjs';
import { LANGUAGES } from './run.mjs';
import { normalizeRepo } from './normalize.mjs';
import { buildRising, buildWeeklyGains } from './rising.mjs';

export const MIN_STARS = 1000;
const PAGES = 10; // 10 x 100 = the 1,000-result cap of the Search API

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SNAP_DIR = join(ROOT, 'data', 'snapshots');
const OUT_DIR = join(ROOT, 'data', 'stars');
const RISING_PATH = join(ROOT, 'data', 'rising.json');
const GAINS_PATH = join(ROOT, 'data', 'weekly-gains.json');
const DATE_FILE = /^(\d{4}-\d{2}-\d{2})\.json$/;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Search qualifiers for the all-time most-starred repos, e.g. `stars:>=1000 language:"C#"`. */
export function allTimeQuery(language) {
  if (!language) return `stars:>=${MIN_STARS}`;
  const needsQuotes = /[^A-Za-z0-9_-]/.test(language);
  return `stars:>=${MIN_STARS} language:${needsQuotes ? `"${language}"` : language}`;
}

const putMax = (out, name, stars) => {
  if (typeof stars === 'number' && !(out[name] >= stars)) out[name] = stars;
};

/** Raw Search API items -> { fullName: stars }, keeping the max on duplicates. */
export function starsFromItems(items) {
  const out = {};
  for (const item of items) putMax(out, item.full_name, item.stargazers_count);
  return out;
}

/** Union of several { fullName: stars } maps, keeping the max per repo. */
export function mergeStars(...maps) {
  const out = {};
  for (const map of maps) for (const [name, stars] of Object.entries(map)) putMax(out, name, stars);
  return out;
}

/** A trending snapshot reduced to its stars file. */
export function starsFromSnapshot(snapshot) {
  const stars = {};
  for (const result of snapshot.results) for (const item of result.items) putMax(stars, item.fullName, item.stars);
  return { date: snapshot.date, stars };
}

/** Snapshot dates that have no stars file yet, sorted. */
export function backfillDates(snapshotDates, starsDates) {
  const have = new Set(starsDates);
  return snapshotDates.filter((d) => !have.has(d)).sort();
}

const datesIn = async (dir) => {
  try {
    return (await readdir(dir)).map((n) => DATE_FILE.exec(n)?.[1]).filter(Boolean);
  } catch {
    return [];
  }
};

const writeStars = (file) => writeFile(join(OUT_DIR, `${file.date}.json`), JSON.stringify(file));

async function main() {
  const token = process.env.GITHUB_TOKEN || null;
  const today = new Date().toISOString().slice(0, 10);
  await mkdir(OUT_DIR, { recursive: true });

  const snapshotDates = await datesIn(SNAP_DIR);
  const starsDates = await datesIn(OUT_DIR);
  for (const date of backfillDates(snapshotDates.filter((d) => d !== today), starsDates)) {
    await writeStars(starsFromSnapshot(JSON.parse(await readFile(join(SNAP_DIR, `${date}.json`), 'utf8'))));
    console.log(`  backfilled ${date} from its snapshot`);
  }

  const jobs = LANGUAGES.flatMap((language) => Array.from({ length: PAGES }, (_, i) => ({ language, page: i + 1 })));
  console.log(`Stars ${today} | ${jobs.length} searches | token: ${token ? 'yes' : 'no'}`);
  const maps = [];
  const details = new Map(); // fullName -> normalized repo, for rising.json
  for (const [i, { language, page }] of jobs.entries()) {
    const { items } = await fetchSearch(searchUrl(allTimeQuery(language), { page }), { token });
    maps.push(starsFromItems(items));
    for (const item of items) details.set(item.full_name, normalizeRepo(item));
    if (page === PAGES) console.log(`  ${(language ?? 'all').padEnd(11)} done`);
    if (items.length < 100) {
      // Fewer than 1,000 repos above the floor: skip this language's remaining pages.
      while (jobs[i + 1]?.language === language) jobs.splice(i + 1, 1);
    }
    if (i < jobs.length - 1) await sleep(paceDelayMs(Boolean(token)));
  }

  if (snapshotDates.includes(today)) {
    const snapshot = JSON.parse(await readFile(join(SNAP_DIR, `${today}.json`), 'utf8'));
    maps.push(starsFromSnapshot(snapshot).stars);
    for (const result of snapshot.results) for (const item of result.items) if (!details.has(item.fullName)) details.set(item.fullName, item);
  }
  const stars = mergeStars(...maps);
  await writeStars({ date: today, stars });
  console.log(`Wrote data/stars/${today}.json (${Object.keys(stars).length} repos)`);

  const files = [];
  for (const date of await datesIn(OUT_DIR)) files.push(JSON.parse(await readFile(join(OUT_DIR, `${date}.json`), 'utf8')));
  const rising = buildRising({ files, repos: details, languages: LANGUAGES.filter(Boolean) });
  await writeFile(RISING_PATH, JSON.stringify(rising));
  console.log(`Wrote data/rising.json (${rising.spanDays} day span${rising.estimated ? ', estimated' : ''}, ${rising.lists.all.length} repos overall)`);

  const weekly = buildWeeklyGains(files);
  await writeFile(GAINS_PATH, JSON.stringify(weekly));
  console.log(`Wrote data/weekly-gains.json (${Object.keys(weekly.gains).length} repos)`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
