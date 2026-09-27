import { test } from 'node:test';
import assert from 'node:assert/strict';
import { periodStart, buildSearchQuery, searchUrl } from '../src/query.mjs';

const now = new Date('2026-09-27T10:30:45.123Z');

test('periodStart: day is 24 hours before now, seconds precision, Z suffix', () => {
  assert.equal(periodStart('day', now), '2026-09-26T10:30:45Z');
});

test('periodStart: week is 7 days before now', () => {
  assert.equal(periodStart('week', now), '2026-09-20T10:30:45Z');
});

test('periodStart: month is 30 days before now', () => {
  assert.equal(periodStart('month', now), '2026-08-28T10:30:45Z');
});

test('periodStart: unknown period throws', () => {
  assert.throws(() => periodStart('year', now), /unknown period/i);
});

test('buildSearchQuery: period and plain language', () => {
  assert.equal(
    buildSearchQuery({ period: 'week', language: 'TypeScript', now }),
    'created:>=2026-09-20T10:30:45Z language:TypeScript'
  );
});

test('buildSearchQuery: language with special characters is quoted', () => {
  assert.equal(
    buildSearchQuery({ period: 'day', language: 'C#', now }),
    'created:>=2026-09-26T10:30:45Z language:"C#"'
  );
  assert.equal(
    buildSearchQuery({ period: 'day', language: 'C++', now }),
    'created:>=2026-09-26T10:30:45Z language:"C++"'
  );
  assert.equal(
    buildSearchQuery({ period: 'day', language: 'Jupyter Notebook', now }),
    'created:>=2026-09-26T10:30:45Z language:"Jupyter Notebook"'
  );
});

test('buildSearchQuery: no language means no language clause', () => {
  assert.equal(buildSearchQuery({ period: 'month', now }), 'created:>=2026-08-28T10:30:45Z');
  assert.equal(buildSearchQuery({ period: 'month', language: null, now }), 'created:>=2026-08-28T10:30:45Z');
});

test('searchUrl: encodes query and sets stars sort with per_page', () => {
  const url = searchUrl('created:>=2026-08-28T10:30:45Z language:"C#"', { perPage: 100 });
  assert.equal(
    url,
    'https://api.github.com/search/repositories?q=created%3A%3E%3D2026-08-28T10%3A30%3A45Z+language%3A%22C%23%22&sort=stars&order=desc&per_page=100'
  );
});

test('searchUrl: perPage defaults to 100', () => {
  assert.match(searchUrl('created:>=2026-08-28T10:30:45Z'), /&per_page=100$/);
});
