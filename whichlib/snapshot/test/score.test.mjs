import { test } from 'node:test';
import assert from 'node:assert/strict';
import score from '../../lib/score.js';

const { scoreRepo, tierFor, logScale, licenseScore, WEIGHTS } = score;

const NOW = Date.parse('2026-09-27T12:00:00Z');
const daysAgo = (d) => new Date(NOW - d * 86400000).toISOString();

const base = {
  fullName: 'acme/widget',
  stars: 1200,
  forks: 90,
  openIssues: 15,
  license: 'mit',
  createdAt: daysAgo(10),
  pushedAt: daysAgo(1),
  archived: false,
};
// Old enough to be graded (not "New"): for tests about verdict wording and flags.
const mature = { ...base, createdAt: daysAgo(400) };

test('logScale: 0 at zero, 1 at max, clamped above max, monotonic', () => {
  assert.equal(logScale(0, 5000), 0);
  assert.equal(logScale(5000, 5000), 1);
  assert.equal(logScale(50000, 5000), 1);
  assert.ok(logScale(50, 5000) < logScale(500, 5000));
  assert.ok(logScale(50, 5000) > 0.4, 'log scale rewards early growth');
});

test('licenseScore: permissive 1, weak copyleft .75, strong copyleft .5, unknown .5, none 0', () => {
  assert.equal(licenseScore('mit'), 1);
  assert.equal(licenseScore('Apache-2.0'), 1);
  assert.equal(licenseScore('bsd-3-clause'), 1);
  assert.equal(licenseScore('mpl-2.0'), 0.75);
  assert.equal(licenseScore('lgpl-3.0'), 0.75);
  assert.equal(licenseScore('gpl-3.0'), 0.5);
  assert.equal(licenseScore('agpl-3.0'), 0.5);
  assert.equal(licenseScore('other'), 0.5);
  assert.equal(licenseScore('something-odd'), 0.5);
  assert.equal(licenseScore(null), 0);
});

test('weights sum to 1', () => {
  const sum = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9);
  assert.deepEqual(WEIGHTS, { momentum: 0.4, maintenance: 0.25, adoption: 0.25, license: 0.1 });
});

test('scoreRepo: returns score, tier, verdict, parts and flags; score equals weighted parts', () => {
  const r = scoreRepo(mature, { starsGained7d: 800, now: NOW });
  assert.ok(Number.isInteger(r.score) && r.score >= 0 && r.score <= 100);
  assert.deepEqual(Object.keys(r.parts).sort(), ['adoption', 'license', 'maintenance', 'momentum']);
  const expected = Math.round(100 * Object.entries(WEIGHTS).reduce((acc, [k, w]) => acc + w * r.parts[k], 0));
  assert.equal(r.score, expected);
  assert.deepEqual(r.flags, []);
  assert.equal(typeof r.verdict, 'string');
});

test('maintenance: pushed within 30 days is 1, at 365+ days is 0, linear between', () => {
  assert.equal(scoreRepo({ ...base, pushedAt: daysAgo(20) }, { now: NOW }).parts.maintenance, 1);
  assert.equal(scoreRepo({ ...base, pushedAt: daysAgo(400) }, { now: NOW }).parts.maintenance, 0);
  const mid = scoreRepo({ ...base, pushedAt: daysAgo(197.5) }, { now: NOW }).parts.maintenance;
  assert.ok(Math.abs(mid - 0.5) < 0.01, `mid was ${mid}`);
  const q = scoreRepo({ ...base, pushedAt: daysAgo(90) }, { now: NOW }).parts.maintenance;
  assert.ok(Math.abs(q - (1 - 60 / 335)) < 1e-9, 'a quarter of silence costs less than a fifth');
});

test('stability guard: widely used repos pushed within a year never drop below 0.5 maintenance', () => {
  // 10k+ stars, 200 days quiet: curve says 0.49, guard lifts to 0.5
  assert.equal(scoreRepo({ ...base, stars: 20000, pushedAt: daysAgo(200) }, { now: NOW }).parts.maintenance, 0.5);
  // 100k+ weekly downloads with few stars: same guard
  assert.equal(scoreRepo({ ...base, stars: 500, weeklyDownloads: 200000, pushedAt: daysAgo(300) }, { now: NOW }).parts.maintenance, 0.5);
  // beyond a year the guard no longer applies
  assert.equal(scoreRepo({ ...base, stars: 20000, pushedAt: daysAgo(400) }, { now: NOW }).parts.maintenance, 0);
  // small repos get no guard
  assert.ok(scoreRepo({ ...base, stars: 1200, pushedAt: daysAgo(300) }, { now: NOW }).parts.maintenance < 0.5);
  // the guard is a floor, not a cap: a fresh widely used repo keeps 1
  assert.equal(scoreRepo({ ...base, stars: 20000, pushedAt: daysAgo(5) }, { now: NOW }).parts.maintenance, 1);
});

test('stability guard: httpx-like profile lands in Solid, not Watch', () => {
  const httpx = { ...base, stars: 15514, forks: 900, openIssues: 60, license: 'bsd-3-clause', createdAt: daysAgo(2700), pushedAt: daysAgo(182), weeklyDownloads: 145000000 };
  const r = scoreRepo(httpx, { now: NOW });
  assert.ok(r.score >= 50 && r.score < 75, `score was ${r.score}`);
  assert.equal(r.tier, 'Solid');
  assert.equal(r.verdict, 'Gaining steadily, 145M downloads/wk, quiet for 6 months, widely used, BSD-3-CLAUSE.');
});

test('maintenance: open issues above a tenth of stars costs 0.2', () => {
  const clean = scoreRepo({ ...base, stars: 1000, openIssues: 50 }, { now: NOW }).parts.maintenance;
  const noisy = scoreRepo({ ...base, stars: 1000, openIssues: 150 }, { now: NOW }).parts.maintenance;
  assert.equal(clean, 1);
  assert.ok(Math.abs(noisy - 0.8) < 1e-9);
});

test('momentum: uses starsGained7d when given, else stars per day since creation times 7', () => {
  const withHistory = scoreRepo(base, { starsGained7d: 500, now: NOW }).parts.momentum;
  assert.ok(Math.abs(withHistory - logScale(500, 5000)) < 1e-9);
  // 1200 stars over 10 days = 120/day -> 840 per week
  const fallback = scoreRepo(base, { now: NOW }).parts.momentum;
  assert.ok(Math.abs(fallback - logScale(840, 5000)) < 1e-6);
});

test('momentum fallback: repo age floored at one day so hours-old repos are not extrapolated into a week', () => {
  const brandNew = { ...base, createdAt: new Date(NOW - 2 * 3600000).toISOString(), stars: 10 };
  const m = scoreRepo(brandNew, { now: NOW }).parts.momentum;
  assert.ok(Math.abs(m - logScale(10 * 7, 5000)) < 1e-6);
});

test('adoption: 70% stars (max 100k) + 30% forks (max 20k)', () => {
  const a = scoreRepo({ ...base, stars: 100000, forks: 20000 }, { now: NOW }).parts.adoption;
  assert.equal(a, 1);
  const b = scoreRepo({ ...base, stars: 0, forks: 0 }, { now: NOW }).parts.adoption;
  assert.equal(b, 0);
});

test('archived: score capped at 20, flagged, verdict says avoid', () => {
  const r = scoreRepo({ ...base, archived: true }, { starsGained7d: 5000, now: NOW });
  assert.ok(r.score <= 20);
  assert.deepEqual(r.flags, ['archived']);
  assert.equal(r.tier, 'Avoid');
  assert.equal(r.verdict, 'Archived, avoid.');
});

test('no license: flagged and named in the verdict', () => {
  const r = scoreRepo({ ...mature, license: null }, { now: NOW });
  assert.deepEqual(r.flags, ['no-license']);
  assert.match(r.verdict, /no license\.$/);
  assert.equal(r.parts.license, 0);
});

test('tierFor: boundaries', () => {
  assert.equal(tierFor(75), 'Strong');
  assert.equal(tierFor(74), 'Solid');
  assert.equal(tierFor(50), 'Solid');
  assert.equal(tierFor(49), 'Watch');
  assert.equal(tierFor(25), 'Watch');
  assert.equal(tierFor(24), 'Avoid');
});

test('verdict wording: momentum phrase, push phrase, license', () => {
  const fast = scoreRepo({ ...mature, pushedAt: daysAgo(0.2) }, { starsGained7d: 2000, now: NOW });
  assert.equal(fast.verdict, 'Rising fast, pushed today, MIT.');
  const steady = scoreRepo({ ...mature, pushedAt: daysAgo(12) }, { starsGained7d: 100, now: NOW });
  assert.equal(steady.verdict, 'Gaining steadily, pushed 12 days ago, MIT.');
  const slow = scoreRepo({ ...mature, pushedAt: daysAgo(60), license: 'gpl-3.0' }, { starsGained7d: 10, now: NOW });
  assert.equal(slow.verdict, 'Slow growth, no push in 60 days, GPL-3.0.');
  const quietButUsed = scoreRepo({ ...mature, stars: 30000, pushedAt: daysAgo(45) }, { starsGained7d: 10, now: NOW });
  assert.equal(quietButUsed.verdict, 'Slow growth, quiet for 1 month, widely used, MIT.');
  const none = scoreRepo({ ...mature, pushedAt: daysAgo(2) }, { starsGained7d: 0, now: NOW });
  assert.equal(none.verdict, 'Little traction, pushed 2 days ago, MIT.');
});

test('adoption with weekly downloads: 50% stars, 20% forks, 30% downloads (max 1M)', () => {
  const full = scoreRepo({ ...base, stars: 100000, forks: 20000, weeklyDownloads: 1000000 }, { now: NOW }).parts.adoption;
  assert.equal(full, 1);
  const onlyDownloads = scoreRepo({ ...base, stars: 0, forks: 0, weeklyDownloads: 1000000 }, { now: NOW }).parts.adoption;
  assert.ok(Math.abs(onlyDownloads - 0.3) < 1e-9);
  const zeroDownloads = scoreRepo({ ...base, stars: 100000, forks: 20000, weeklyDownloads: 0 }, { now: NOW }).parts.adoption;
  assert.ok(Math.abs(zeroDownloads - 0.7) < 1e-9, 'known-zero downloads count against the repo');
});

test('adoption without downloads is unchanged: 70% stars, 30% forks', () => {
  const a = scoreRepo({ ...base, stars: 100000, forks: 20000, weeklyDownloads: null }, { now: NOW }).parts.adoption;
  assert.equal(a, 1);
  const b = scoreRepo({ ...base, stars: 100000, forks: 0 }, { now: NOW }).parts.adoption;
  assert.ok(Math.abs(b - 0.7) < 1e-9);
});

test('verdict names weekly downloads when known', () => {
  const r = scoreRepo({ ...mature, pushedAt: daysAgo(1), weeklyDownloads: 12345 }, { starsGained7d: 2000, now: NOW });
  assert.equal(r.verdict, 'Rising fast, 12.3k downloads/wk, pushed 1 day ago, MIT.');
  const big = scoreRepo({ ...mature, pushedAt: daysAgo(1), weeklyDownloads: 2500000 }, { starsGained7d: 2000, now: NOW });
  assert.equal(big.verdict, 'Rising fast, 2.5M downloads/wk, pushed 1 day ago, MIT.');
  const small = scoreRepo({ ...mature, pushedAt: daysAgo(1), weeklyDownloads: 42 }, { starsGained7d: 2000, now: NOW });
  assert.equal(small.verdict, 'Rising fast, 42 downloads/wk, pushed 1 day ago, MIT.');
});

test('momentum fallback: scaled by the downloads trend, clamped to 0.5-2x', () => {
  const old = { ...base, stars: 7000, createdAt: daysAgo(700) }; // 70 stars/week over its life
  const m = (downloadsTrend) => scoreRepo(old, { now: NOW, downloadsTrend }).parts.momentum;
  assert.equal(m(1.5), logScale(105, 5000));
  assert.equal(m(9), logScale(140, 5000));
  assert.equal(m(0.1), logScale(35, 5000));
  assert.equal(m(null), logScale(70, 5000));
  assert.equal(m(undefined), logScale(70, 5000));
});

test('momentum: real stars gained ignore the downloads trend', () => {
  assert.equal(scoreRepo(base, { now: NOW, starsGained7d: 50, downloadsTrend: 2 }).parts.momentum, logScale(50, 5000));
});

test('too new: under 30 days old the tier is New, flagged, and the verdict says so; the score is unchanged', () => {
  const young = { ...base, stars: 2000, createdAt: new Date(NOW - 10 * 3600000).toISOString() };
  const r = scoreRepo(young, { now: NOW });
  const asOld = scoreRepo({ ...young, createdAt: daysAgo(400) }, { now: NOW, starsGained7d: null });
  assert.equal(r.tier, 'New');
  assert.ok(r.flags.includes('too-new'));
  assert.match(r.verdict, /^Too new to judge \(10 hours old\): /);
  assert.equal(r.score, Math.round(100 * Object.keys(WEIGHTS).reduce((a, k) => a + WEIGHTS[k] * r.parts[k], 0)));
  assert.notEqual(asOld.tier, 'New');
});

test('too new: ages read in days from one day on; 30 days and older is judged normally', () => {
  assert.match(scoreRepo({ ...base, createdAt: daysAgo(12) }, { now: NOW }).verdict, /^Too new to judge \(12 days old\)/);
  assert.match(scoreRepo({ ...base, createdAt: daysAgo(1) }, { now: NOW }).verdict, /\(1 day old\)/);
  const month = scoreRepo({ ...base, createdAt: daysAgo(30) }, { now: NOW });
  assert.notEqual(month.tier, 'New');
  assert.ok(!month.flags.includes('too-new'));
});

test('too new: archived still wins (Avoid)', () => {
  const r = scoreRepo({ ...base, archived: true }, { now: NOW });
  assert.equal(r.tier, 'Avoid');
  assert.match(r.verdict, /^Archived/);
});
