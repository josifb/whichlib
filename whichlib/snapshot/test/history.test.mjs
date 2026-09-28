import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildHistory, starsGained, latestRepos, historyFromStars, weeklyGain, isWeeklyEstimate } from '../src/history.mjs';

const repo = (fullName, stars, extra = {}) => ({
  fullName, url: `https://github.com/${fullName}`, description: '', language: 'Go',
  stars, forks: 1, openIssues: 0, license: 'mit', createdAt: '2026-09-01T00:00:00Z',
  pushedAt: '2026-09-20T00:00:00Z', archived: false, topics: [], ...extra,
});

const snapshots = [
  {
    date: '2026-09-20', fetchedAt: '2026-09-20T07:00:00Z',
    results: [
      { period: 'week', language: null, totalCount: 10, items: [repo('a/one', 100), repo('b/two', 40)] },
      { period: 'week', language: 'Go', totalCount: 5, items: [repo('a/one', 101)] }, // same day, slightly later count
    ],
  },
  {
    date: '2026-09-27', fetchedAt: '2026-09-27T07:00:00Z',
    results: [
      { period: 'week', language: null, totalCount: 12, items: [repo('a/one', 160), repo('c/three', 900)] },
    ],
  },
];

test('buildHistory: one series per repo, one point per date, max stars when duplicated on a date', () => {
  const h = buildHistory(snapshots);
  assert.deepEqual([...h.keys()].sort(), ['a/one', 'b/two', 'c/three']);
  assert.deepEqual(h.get('a/one').map((p) => [p.date, p.stars]), [['2026-09-20', 101], ['2026-09-27', 160]]);
  assert.deepEqual(h.get('b/two').map((p) => [p.date, p.stars]), [['2026-09-20', 40]]);
});

test('buildHistory: series are sorted by date even if snapshots arrive out of order', () => {
  const h = buildHistory([snapshots[1], snapshots[0]]);
  assert.deepEqual(h.get('a/one').map((p) => p.date), ['2026-09-20', '2026-09-27']);
});

test('starsGained: latest minus earliest point within the window', () => {
  const h = buildHistory(snapshots);
  assert.equal(starsGained(h.get('a/one'), 7, '2026-09-27'), 59);
  assert.equal(starsGained(h.get('a/one'), 30, '2026-09-27'), 59);
});

test('starsGained: null when fewer than two points in the window', () => {
  const h = buildHistory(snapshots);
  assert.equal(starsGained(h.get('c/three'), 7, '2026-09-27'), null);
  assert.equal(starsGained(h.get('a/one'), 3, '2026-09-27'), null); // 09-20 falls outside a 3-day window
  assert.equal(starsGained(undefined, 7, '2026-09-27'), null);
});

test('latestRepos: unique repos from the newest snapshot, keeping the record with the most stars', () => {
  const latest = latestRepos(snapshots);
  assert.deepEqual(latest.map((r) => r.fullName).sort(), ['a/one', 'c/three']);
  assert.equal(latest.find((r) => r.fullName === 'a/one').stars, 160);
});

const day = (date, stars) => ({ date, stars });

test('historyFromStars: one date-sorted series per repo from stars files', () => {
  const h = historyFromStars([
    { date: '2026-09-28', stars: { 'a/one': 20, 'b/two': 3 } },
    { date: '2026-09-21', stars: { 'a/one': 10 } },
  ]);
  assert.deepEqual(h.get('a/one'), [day('2026-09-21', 10), day('2026-09-28', 20)]);
  assert.deepEqual(h.get('b/two'), [day('2026-09-28', 3)]);
});

test('weeklyGain: full 7-day window is the plain difference', () => {
  assert.equal(weeklyGain([day('2026-09-20', 5), day('2026-09-21', 10), day('2026-09-28', 70)], '2026-09-28'), 60);
});

test('weeklyGain: 3 to 6 days of span is scaled to a week', () => {
  assert.equal(weeklyGain([day('2026-09-25', 100), day('2026-09-28', 130)], '2026-09-28'), 70);
});

test('weeklyGain: under 3 days of span, one point, or no series is null', () => {
  assert.equal(weeklyGain([day('2026-09-27', 100), day('2026-09-28', 130)], '2026-09-28'), null);
  assert.equal(weeklyGain([day('2026-09-28', 100)], '2026-09-28'), null);
  assert.equal(weeklyGain(undefined, '2026-09-28'), null);
});

test('weeklyGain: never negative (unstars or a renamed repo)', () => {
  assert.equal(weeklyGain([day('2026-09-21', 100), day('2026-09-28', 90)], '2026-09-28'), 0);
});

test('weeklyGain: a scaled estimate never exceeds the repo\'s current stars', () => {
  // 10 -> 100 in 3 days scales to 210 a week, more than the 100 it has
  assert.equal(weeklyGain([day('2026-09-25', 10), day('2026-09-28', 100)], '2026-09-28'), 100);
});

test('isWeeklyEstimate: true only when the window spans 3-6 days', () => {
  assert.equal(isWeeklyEstimate([day('2026-09-25', 10), day('2026-09-28', 100)], '2026-09-28'), true);
  assert.equal(isWeeklyEstimate([day('2026-09-21', 10), day('2026-09-28', 100)], '2026-09-28'), false);
  assert.equal(isWeeklyEstimate([day('2026-09-27', 10), day('2026-09-28', 100)], '2026-09-28'), false);
});
