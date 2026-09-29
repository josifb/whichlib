// "Rising": repos of any age ranked by stars gained over the last week, from
// the daily star counts. Written by stars.mjs as data/rising.json and read by
// the dashboard and the MCP server (trending_repos, period "rising").

import { historyFromStars, weeklyGain, isWeeklyEstimate } from './history.mjs';

const MIN_SPAN_DAYS = 3; // same rule as weeklyGain: under 3 days there is no gain
const DAY_MS = 86400000;

/**
 * @param files     stars files ({ date, stars: { fullName: n } })
 * @param repos     Map fullName -> normalized repo (details for display and scoring)
 * @param languages per-language lists to build besides "all"
 * @param perList   max repos per list
 * @returns {{ date, days, spanDays, estimated, lists: Record<string, object[]> }}
 */
export function buildRising({ files, repos, languages, perList = 100 }) {
  const empty = () => Object.fromEntries([['all', []], ...languages.map((l) => [l, []])]);
  if (files.length === 0) return { date: null, days: 0, spanDays: 0, estimated: false, lists: empty() };

  const sorted = [...files].sort((a, b) => a.date.localeCompare(b.date));
  const date = sorted.at(-1).date;
  const windowStart = Date.parse(date) - 7 * DAY_MS;
  const inWindow = sorted.filter((f) => Date.parse(f.date) >= windowStart);
  const spanDays = (Date.parse(date) - Date.parse(inWindow[0].date)) / DAY_MS;
  const base = { date, days: sorted.length, spanDays, estimated: spanDays >= MIN_SPAN_DAYS && spanDays < 7 };
  if (spanDays < MIN_SPAN_DAYS) return { ...base, lists: empty() };

  const history = historyFromStars(sorted);
  const ranked = [];
  for (const [fullName, series] of history) {
    const gained = weeklyGain(series, date);
    const details = repos.get(fullName);
    if (gained === null || gained <= 0 || !details) continue;
    ranked.push({ ...details, gained, estimated: isWeeklyEstimate(series, date) });
  }
  ranked.sort((a, b) => b.gained - a.gained || b.stars - a.stars);

  const lists = { all: ranked.slice(0, perList) };
  for (const language of languages) lists[language] = ranked.filter((r) => r.language === language).slice(0, perList);
  return { ...base, lists };
}
