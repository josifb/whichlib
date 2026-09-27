/*
 * whichlib score. Shared by the browser dashboard (plain <script> tag)
 * and Node (CommonJS import). Keep this file free of imports.
 *
 * scoreRepo(repo, { starsGained7d, now }) -> { score, tier, verdict, parts, flags, weights }
 *   repo: { stars, forks, openIssues, license, createdAt, pushedAt, archived,
 *           weeklyDownloads? (number when known from npm/PyPI, else null/absent) }
 *   starsGained7d: stars gained over the last 7 days from snapshots, or null
 *
 * See README "Score" for the definition.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WhichlibScore = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const WEIGHTS = { momentum: 0.4, maintenance: 0.25, adoption: 0.25, license: 0.1 };

  const MOMENTUM_MAX_PER_WEEK = 5000;
  const STARS_MAX = 100000;
  const FORKS_MAX = 20000;
  const DOWNLOADS_MAX = 1000000; // weekly registry downloads
  const FRESH_DAYS = 7;
  const STALE_DAYS = 90;
  const ISSUE_RATIO_LIMIT = 0.1;
  const ISSUE_PENALTY = 0.2;
  const ARCHIVED_CAP = 20;
  const MIN_AGE_DAYS = 1; // never extrapolate less than a day of evidence into a week
  const DAY_MS = 86400000;

  const PERMISSIVE = new Set(['mit', 'apache-2.0', 'bsd-2-clause', 'bsd-3-clause', 'bsd-3-clause-clear', 'isc', '0bsd', 'unlicense', 'zlib', 'cc0-1.0', 'bsl-1.0', 'wtfpl', 'postgresql', 'ncsa', 'artistic-2.0', 'ms-pl', 'upl-1.0', 'blueoak-1.0.0']);
  const WEAK_COPYLEFT = new Set(['mpl-2.0', 'lgpl-2.1', 'lgpl-3.0', 'epl-1.0', 'epl-2.0', 'cddl-1.0', 'osl-3.0', 'eupl-1.1', 'eupl-1.2', 'cecill-2.1']);
  const STRONG_COPYLEFT = new Set(['gpl-2.0', 'gpl-3.0', 'agpl-3.0', 'sspl-1.0', 'cc-by-sa-4.0', 'ofl-1.1']);

  const clamp01 = (v) => Math.min(1, Math.max(0, v));

  function logScale(value, max) {
    if (!(value > 0)) return 0;
    return clamp01(Math.log10(1 + value) / Math.log10(1 + max));
  }

  function licenseScore(key) {
    if (!key) return 0;
    const k = String(key).toLowerCase();
    if (PERMISSIVE.has(k)) return 1;
    if (WEAK_COPYLEFT.has(k)) return 0.75;
    if (STRONG_COPYLEFT.has(k)) return 0.5;
    return 0.5; // "other", NOASSERTION, or something we do not recognise
  }

  function tierFor(score) {
    if (score >= 75) return 'Strong';
    if (score >= 50) return 'Promising';
    if (score >= 25) return 'Watch';
    return 'Avoid';
  }

  function momentumScore(repo, starsGained7d, now) {
    if (starsGained7d !== null && starsGained7d !== undefined) return logScale(starsGained7d, MOMENTUM_MAX_PER_WEEK);
    const ageDays = Math.max(MIN_AGE_DAYS, (now - Date.parse(repo.createdAt)) / DAY_MS);
    return logScale((repo.stars / ageDays) * 7, MOMENTUM_MAX_PER_WEEK);
  }

  function maintenanceScore(repo, now) {
    const days = (now - Date.parse(repo.pushedAt)) / DAY_MS;
    let fresh;
    if (days <= FRESH_DAYS) fresh = 1;
    else if (days >= STALE_DAYS) fresh = 0;
    else fresh = 1 - (days - FRESH_DAYS) / (STALE_DAYS - FRESH_DAYS);
    const ratio = (repo.openIssues || 0) / Math.max(1, repo.stars || 0);
    return clamp01(fresh - (ratio > ISSUE_RATIO_LIMIT ? ISSUE_PENALTY : 0));
  }

  function adoptionScore(repo) {
    const stars = logScale(repo.stars, STARS_MAX);
    const forks = logScale(repo.forks, FORKS_MAX);
    if (typeof repo.weeklyDownloads === 'number') {
      return 0.5 * stars + 0.2 * forks + 0.3 * logScale(repo.weeklyDownloads, DOWNLOADS_MAX);
    }
    return 0.7 * stars + 0.3 * forks;
  }

  function compactNumber(n) {
    if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
    if (n >= 1e3) return `${(n / 1e3).toFixed(1).replace(/\.0$/, '')}k`;
    return String(n);
  }

  function momentumPhrase(m) {
    if (m >= 0.6) return 'Rising fast';
    if (m >= 0.35) return 'Gaining steadily';
    if (m >= 0.15) return 'Slow growth';
    return 'Little traction';
  }

  function pushPhrase(repo, now) {
    const days = Math.floor((now - Date.parse(repo.pushedAt)) / DAY_MS);
    if (days < 1) return 'pushed today';
    if (days <= 30) return `pushed ${days} day${days === 1 ? '' : 's'} ago`;
    return `no push in ${days} days`;
  }

  function licensePhrase(key) {
    return key ? String(key).toUpperCase() : 'no license';
  }

  function scoreRepo(repo, opts) {
    const o = opts || {};
    const now = typeof o.now === 'number' ? o.now : Date.now();
    const starsGained7d = o.starsGained7d === undefined ? null : o.starsGained7d;

    const parts = {
      momentum: momentumScore(repo, starsGained7d, now),
      maintenance: maintenanceScore(repo, now),
      adoption: adoptionScore(repo),
      license: licenseScore(repo.license),
    };
    const flags = [];
    let score = Math.round(100 * Object.keys(WEIGHTS).reduce((acc, k) => acc + WEIGHTS[k] * parts[k], 0));

    if (repo.archived) {
      flags.push('archived');
      score = Math.min(score, ARCHIVED_CAP);
    }
    if (!repo.license) flags.push('no-license');

    const downloads = typeof repo.weeklyDownloads === 'number' ? `${compactNumber(repo.weeklyDownloads)} downloads/wk, ` : '';
    const verdict = repo.archived
      ? 'Archived, avoid.'
      : `${momentumPhrase(parts.momentum)}, ${downloads}${pushPhrase(repo, now)}, ${licensePhrase(repo.license)}.`;

    return { score, tier: tierFor(score), verdict, parts, flags, weights: WEIGHTS };
  }

  return { scoreRepo, tierFor, logScale, licenseScore, WEIGHTS };
});
