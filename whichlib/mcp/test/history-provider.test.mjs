import { test } from 'node:test';
import assert from 'node:assert/strict';
import { providerFromGains, emptyHistory, WEEKLY_GAINS_URL } from '../history-provider.mjs';

const gains = { date: '2026-10-05', days: 8, spanDays: 7, estimated: false, gains: { 'a/one': [40, false], 'b/two': [70, true] } };

test('providerFromGains: same shape as buildProvider, lookups from the gains map', () => {
  const p = providerFromGains(gains, 'hosted');
  assert.equal(p.days, 8);
  assert.equal(p.spanDays, 7);
  assert.equal(p.latestDate, '2026-10-05');
  assert.equal(p.source, 'hosted');
  assert.equal(p.starsGained7d('a/one'), 40);
  assert.equal(p.starsGainedEstimated('a/one'), false);
  assert.equal(p.starsGainedEstimated('b/two'), true);
  assert.equal(p.starsGained7d('x/none'), null);
  assert.equal(p.starsGainedEstimated('x/none'), false);
  assert.deepEqual(Object.keys(p).sort(), Object.keys(emptyHistory).sort());
});

test('providerFromGains: missing or malformed file is the empty history', () => {
  for (const bad of [null, undefined, {}, { date: '2026-10-05' }]) {
    const p = providerFromGains(bad, 'hosted');
    assert.equal(p.days, 0);
    assert.equal(p.starsGained7d('a/one'), null);
  }
});

test('WEEKLY_GAINS_URL points at the data branch root', () => {
  assert.equal(WEEKLY_GAINS_URL, 'https://raw.githubusercontent.com/josifb/whichlib/data/weekly-gains.json');
});
