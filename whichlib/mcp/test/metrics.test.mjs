import { test } from 'node:test';
import assert from 'node:assert/strict';
import { firstHitRank, summarize } from '../eval/metrics.mjs';

test('firstHitRank: 1-based, case-insensitive, null when absent', () => {
  assert.equal(firstHitRank(['a/x', 'B/Y', 'c/z'], ['b/y', 'c/z']), 2);
  assert.equal(firstHitRank(['a/x'], ['b/y']), null);
  assert.equal(firstHitRank([], ['b/y']), null);
});

test('summarize: hit@k fractions and MRR', () => {
  const s = summarize([1, 3, null, 6]);
  assert.equal(s.n, 4);
  assert.equal(s.hitAt1, 0.25);
  assert.equal(s.hitAt3, 0.5);
  assert.equal(s.hitAt5, 0.5);
  assert.ok(Math.abs(s.mrr - (1 + 1 / 3 + 0 + 1 / 6) / 4) < 1e-12);
  assert.deepEqual(summarize([]), { n: 0, hitAt1: 0, hitAt3: 0, hitAt5: 0, mrr: 0 });
});
