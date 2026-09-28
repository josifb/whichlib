import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allTimeQuery, starsFromItems, mergeStars, starsFromSnapshot, backfillDates, MIN_STARS } from '../src/stars.mjs';
import { searchUrl } from '../src/query.mjs';

test('allTimeQuery: star floor, optional quoted language', () => {
  assert.equal(allTimeQuery(null), `stars:>=${MIN_STARS}`);
  assert.equal(allTimeQuery('Python'), `stars:>=${MIN_STARS} language:Python`);
  assert.equal(allTimeQuery('C#'), `stars:>=${MIN_STARS} language:"C#"`);
});

test('searchUrl: page parameter only when given', () => {
  assert.doesNotMatch(searchUrl('x'), /&page=/);
  assert.match(searchUrl('x', { page: 3 }), /&page=3$/);
});

test('starsFromItems: raw search items to fullName -> stars, max on duplicates', () => {
  const items = [
    { full_name: 'a/one', stargazers_count: 10 },
    { full_name: 'b/two', stargazers_count: 5 },
    { full_name: 'a/one', stargazers_count: 12 },
  ];
  assert.deepEqual(starsFromItems(items), { 'a/one': 12, 'b/two': 5 });
});

test('mergeStars: union keeps the max per repo', () => {
  assert.deepEqual(mergeStars({ 'a/one': 1, 'b/two': 7 }, { 'a/one': 3 }, {}), { 'a/one': 3, 'b/two': 7 });
});

test('starsFromSnapshot: date plus every repo in every result', () => {
  const snap = {
    date: '2026-09-27',
    results: [
      { items: [{ fullName: 'a/one', stars: 4 }] },
      { items: [{ fullName: 'a/one', stars: 6 }, { fullName: 'c/three', stars: 2 }] },
    ],
  };
  assert.deepEqual(starsFromSnapshot(snap), { date: '2026-09-27', stars: { 'a/one': 6, 'c/three': 2 } });
});

test('backfillDates: snapshot dates without a stars file, sorted', () => {
  assert.deepEqual(backfillDates(['2026-09-28', '2026-09-26', '2026-09-27'], ['2026-09-27']), ['2026-09-26', '2026-09-28']);
});
