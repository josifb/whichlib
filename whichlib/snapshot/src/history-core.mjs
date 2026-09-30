// Pure star-history functions (no Node built-ins): shared by the npm package,
// the snapshot jobs and the hosted Worker. Disk loaders live in history.mjs.

const DAY_MS = 86400000;

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

/** Map fullName -> [{ date, stars }] sorted by date, from stars files. */
export function historyFromStars(files) {
  const history = new Map();
  for (const file of [...files].sort((a, b) => a.date.localeCompare(b.date))) {
    for (const [name, stars] of Object.entries(file.stars)) {
      let series = history.get(name);
      if (!series) { series = []; history.set(name, series); }
      series.push({ date: file.date, stars });
    }
  }
  return history;
}

const MIN_SPAN_DAYS = 3;

/** First and last point inside the 7 days up to asOfDate, and the days between them; null under two points. */
function weekWindow(series, asOfDate) {
  if (!series || series.length < 2) return null;
  const asOf = Date.parse(`${asOfDate}T00:00:00Z`);
  const inWindow = series.filter((p) => {
    const t = Date.parse(`${p.date}T00:00:00Z`);
    return t >= asOf - 7 * DAY_MS && t <= asOf;
  });
  if (inWindow.length < 2) return null;
  const first = inWindow[0];
  const last = inWindow[inWindow.length - 1];
  return { first, last, span: (Date.parse(`${last.date}T00:00:00Z`) - Date.parse(`${first.date}T00:00:00Z`)) / DAY_MS };
}

/**
 * Stars gained per week, from the points inside the 7 days up to asOfDate.
 * A span of 3-6 days is scaled up to a week (an estimate, capped at the
 * repo's current stars so it never claims more than exists); under 3 days
 * it is null, so a single day's gain is never reported as a week's. Never
 * negative.
 */
export function weeklyGain(series, asOfDate) {
  const w = weekWindow(series, asOfDate);
  if (!w || w.span < MIN_SPAN_DAYS) return null;
  const gain = Math.max(0, w.last.stars - w.first.stars);
  return w.span >= 7 ? gain : Math.min(w.last.stars, Math.round((gain * 7) / w.span));
}

/** True when weeklyGain is scaled up from 3-6 days rather than measured over 7. */
export function isWeeklyEstimate(series, asOfDate) {
  const w = weekWindow(series, asOfDate);
  return Boolean(w && w.span >= MIN_SPAN_DAYS && w.span < 7);
}
