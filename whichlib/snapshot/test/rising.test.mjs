import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRising, buildWeeklyGains } from '../src/rising.mjs';

const repo = (fullName, language, stars) => ({
  fullName, url: `https://github.com/${fullName}`, description: '', language, stars, forks: 1, openIssues: 0,
  license: 'mit', createdAt: '2020-01-01T00:00:00Z', pushedAt: '2026-09-27T00:00:00Z', archived: false, topics: [],
});

const files = [
  { date: '2026-09-21', stars: { 'a/py': 1000, 'b/js': 5000, 'c/go': 300, 'd/py': 10 } },
  { date: '2026-09-28', stars: { 'a/py': 1400, 'b/js': 5100, 'c/go': 900, 'd/py': 11, 'e/new': 50 } },
];
const repos = new Map([
  ['a/py', repo('a/py', 'Python', 1400)],
  ['b/js', repo('b/js', 'JavaScript', 5100)],
  ['c/go', repo('c/go', 'Go', 900)],
  ['d/py', repo('d/py', 'Python', 11)],
  ['e/new', repo('e/new', 'Rust', 50)],
]);

test('buildRising: ranks by weekly stars gained, overall and per language', () => {
  const r = buildRising({ files, repos, languages: ['Python', 'Go', 'Rust'] });
  assert.equal(r.date, '2026-09-28');
  assert.equal(r.days, 2);
  assert.equal(r.spanDays, 7);
  assert.equal(r.estimated, false);
  assert.deepEqual(r.lists.all.map((x) => [x.fullName, x.gained]), [['c/go', 600], ['a/py', 400], ['b/js', 100], ['d/py', 1]]);
  assert.deepEqual(r.lists.Python.map((x) => x.fullName), ['a/py', 'd/py']);
  assert.deepEqual(r.lists.Rust, []); // only one point: no gain, not listed
  assert.equal(r.lists.all[0].description, '');
  assert.equal(r.lists.all[0].estimated, false);
});

test('buildRising: repos without details are skipped; perList caps each list', () => {
  const r = buildRising({ files, repos: new Map([['a/py', repos.get('a/py')], ['c/go', repos.get('c/go')]]), languages: [], perList: 1 });
  assert.deepEqual(r.lists.all.map((x) => x.fullName), ['c/go']);
});

test('buildRising: under 3 days of span the lists are empty', () => {
  const r = buildRising({ files: [{ date: '2026-09-27', stars: { 'a/py': 1 } }, { date: '2026-09-28', stars: { 'a/py': 9 } }], repos, languages: ['Python'] });
  assert.equal(r.spanDays, 1);
  assert.deepEqual(r.lists, { all: [], Python: [] });
});

test('buildRising: 3-6 days of span marks the lists as estimated', () => {
  const r = buildRising({ files: [{ date: '2026-09-25', stars: { 'a/py': 1000 } }, { date: '2026-09-28', stars: { 'a/py': 1030 } }], repos, languages: [] });
  assert.equal(r.estimated, true);
  assert.deepEqual(r.lists.all.map((x) => [x.fullName, x.gained, x.estimated]), [['a/py', 70, true]]);
});

test('buildRising: no files gives empty lists', () => {
  const r = buildRising({ files: [], repos, languages: ['Go'] });
  assert.deepEqual(r, { date: null, days: 0, spanDays: 0, estimated: false, lists: { all: [], Go: [] } });
});

test('buildWeeklyGains: every repo with a positive weekly gain, with the estimate flag', () => {
  const w = buildWeeklyGains(files);
  assert.equal(w.date, '2026-09-28');
  assert.equal(w.days, 2);
  assert.equal(w.spanDays, 7);
  assert.equal(w.estimated, false);
  assert.deepEqual(w.gains, { 'a/py': [400, false], 'b/js': [100, false], 'c/go': [600, false], 'd/py': [1, false] });
});

test('buildWeeklyGains: under 3 days of span there are no gains; 3-6 days are estimates', () => {
  const short = buildWeeklyGains([{ date: '2026-09-27', stars: { 'a/py': 1 } }, { date: '2026-09-28', stars: { 'a/py': 9 } }]);
  assert.deepEqual(short.gains, {});
  const est = buildWeeklyGains([{ date: '2026-09-25', stars: { 'a/py': 1000 } }, { date: '2026-09-28', stars: { 'a/py': 1030 } }]);
  assert.equal(est.estimated, true);
  assert.deepEqual(est.gains, { 'a/py': [70, true] });
});

test('buildWeeklyGains: no files', () => {
  assert.deepEqual(buildWeeklyGains([]), { date: null, days: 0, spanDays: 0, estimated: false, gains: {} });
});

test('buildRising and buildWeeklyGains: days counts only files inside the 7-day window', () => {
  const olderFiles = [
    { date: '2026-09-01', stars: { 'a/py': 100 } },
    { date: '2026-09-10', stars: { 'a/py': 200 } },
    { date: '2026-09-21', stars: { 'a/py': 1000 } },
    { date: '2026-09-28', stars: { 'a/py': 1400 } },
  ];
  const r = buildRising({ files: olderFiles, repos, languages: [] });
  assert.equal(r.days, 2);
  const w = buildWeeklyGains(olderFiles);
  assert.equal(w.days, 2);
});
