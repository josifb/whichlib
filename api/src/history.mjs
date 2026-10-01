// Momentum history for the hosted tools: one small daily file
// (weekly-gains.json on the data branch) instead of ten star files, kept in
// the isolate for 6 h. Missing file: fallback momentum (empty history).

import { providerFromGains, emptyHistory, WEEKLY_GAINS_URL } from '../../whichlib/mcp/history-provider.mjs';

const FRESH_MS = 6 * 3600_000;
const RETRY_MS = 5 * 60_000;

export function createHistoryLoader({ fetchImpl = fetch, now = Date.now } = {}) {
  let history = null;
  let validUntil = 0;
  let refreshing = null; // single flight: concurrent callers share one download

  async function refresh() {
    try {
      const res = await fetchImpl(WEEKLY_GAINS_URL, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const fresh = providerFromGains(await res.json(), 'weekly-gains');
      if (!fresh.days) throw new Error('empty history'); // a malformed file counts as a failure
      history = fresh;
      validUntil = now() + FRESH_MS;
    } catch {
      // Keep the last good history if there is one. Only one refresh runs at a
      // time, so this cannot shorten the freshness of a newer successful fetch.
      if (!history?.days) history = { ...emptyHistory, source: 'none' };
      validUntil = now() + RETRY_MS;
    }
    return history;
  }

  return async function loadHistory() {
    if (history && now() < validUntil) return history;
    refreshing ??= refresh().finally(() => { refreshing = null; });
    return refreshing;
  };
}
