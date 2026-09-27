// Turns the daily snapshot files into per-repo star series so momentum can
// use real stars-gained figures instead of the stars-per-day fallback.

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const DAY_MS = 86400000;

/** Read every data/snapshots/*.json, sorted by date. */
export async function loadSnapshots(dir) {
  const names = (await readdir(dir)).filter((n) => /^\d{4}-\d{2}-\d{2}\.json$/.test(n)).sort();
  const out = [];
  for (const name of names) out.push(JSON.parse(await readFile(join(dir, name), 'utf8')));
  return out;
}

/**
 * Map fullName -> [{ date, stars, forks, openIssues, pushedAt }] sorted by
 * date. A repo seen several times on one date (different period or language
 * queries) keeps the record with the most stars.
 */
export function buildHistory(snapshots) {
  const byRepo = new Map();
  for (const snap of snapshots) {
    for (const result of snap.results) {
      for (const item of result.items) {
        let series = byRepo.get(item.fullName);
        if (!series) { series = new Map(); byRepo.set(item.fullName, series); }
        const prev = series.get(snap.date);
        if (!prev || item.stars > prev.stars) {
          series.set(snap.date, { date: snap.date, stars: item.stars, forks: item.forks, openIssues: item.openIssues, pushedAt: item.pushedAt });
        }
      }
    }
  }
  const history = new Map();
  for (const [name, series] of byRepo) {
    history.set(name, [...series.values()].sort((a, b) => a.date.localeCompare(b.date)));
  }
  return history;
}

/**
 * Stars gained between the earliest point inside the window and the latest
 * point. Null when the window holds fewer than two points.
 */
export function starsGained(series, days, asOfDate) {
  if (!series || series.length < 2) return null;
  const asOf = Date.parse(`${asOfDate}T00:00:00Z`);
  const from = asOf - days * DAY_MS;
  const inWindow = series.filter((p) => {
    const t = Date.parse(`${p.date}T00:00:00Z`);
    return t >= from && t <= asOf;
  });
  if (inWindow.length < 2) return null;
  return inWindow[inWindow.length - 1].stars - inWindow[0].stars;
}

/** Unique repos from the newest snapshot, keeping the record with the most stars. */
export function latestRepos(snapshots) {
  if (snapshots.length === 0) return [];
  const latest = [...snapshots].sort((a, b) => a.date.localeCompare(b.date)).at(-1);
  const best = new Map();
  for (const result of latest.results) {
    for (const item of result.items) {
      const prev = best.get(item.fullName);
      if (!prev || item.stars > prev.stars) best.set(item.fullName, item);
    }
  }
  return [...best.values()];
}
