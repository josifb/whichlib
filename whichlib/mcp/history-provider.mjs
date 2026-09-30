// The history object createTools reads (days, spanDays, latestDate, source, starsGained7d, starsGainedEstimated), built from star files (npm package) or from the daily weekly-gains.json (hosted Worker), plus the public data URLs. No Node built-ins.

import { historyFromStars, weeklyGain, isWeeklyEstimate } from '../snapshot/src/history-core.mjs';

export const STARS_URL = 'https://raw.githubusercontent.com/josifb/whichlib/data/stars';
export const RISING_URL = 'https://raw.githubusercontent.com/josifb/whichlib/data/rising.json';
const RISING_TTL_MS = 3600_000;
const DAY_MS = 86400000;

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

export const WEEKLY_GAINS_URL = 'https://raw.githubusercontent.com/josifb/whichlib/data/weekly-gains.json';

/**
 * History values from the daily weekly-gains.json
 * ({ date, days, spanDays, estimated, gains: { fullName: [gained, estimated] } }).
 * Missing or malformed input gives the empty history.
 */
export function providerFromGains(file, source) {
  if (!file || typeof file.date !== 'string' || !file.gains || typeof file.gains !== 'object') return { ...emptyHistory, source };
  const gains = file.gains;
  const entry = (name) => {
    const e = gains[name];
    return Array.isArray(e) && Number.isFinite(e[0]) ? e : null;
  };
  const num = (v) => (Number.isFinite(v) ? v : 0);
  return {
    days: num(file.days),
    spanDays: num(file.spanDays),
    latestDate: file.date,
    source,
    starsGained7d: (fullName) => entry(fullName)?.[0] ?? null,
    starsGainedEstimated: (fullName) => Boolean(entry(fullName)?.[1]),
  };
}
