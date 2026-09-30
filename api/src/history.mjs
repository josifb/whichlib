// Momentum history for the hosted tools: one small daily file
// (weekly-gains.json on the data branch) instead of ten star files, kept in
// the isolate for 6 h. Missing file: fallback momentum (empty history).

import { providerFromGains, emptyHistory, WEEKLY_GAINS_URL } from '../../whichlib/mcp/history-provider.mjs';

const FRESH_MS = 6 * 3600_000;
const RETRY_MS = 5 * 60_000;

export function createHistoryLoader({ fetchImpl = fetch, now = Date.now } = {}) {
  let history = null;
  let validUntil = 0;
  return async function loadHistory() {
    if (history && now() < validUntil) return history;
    try {
      const res = await fetchImpl(WEEKLY_GAINS_URL, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      history = providerFromGains(await res.json(), 'weekly-gains');
      validUntil = now() + FRESH_MS;
    } catch {
      if (!history?.days) history = { ...emptyHistory, source: 'none' };
      validUntil = now() + RETRY_MS;
    }
    return history;
  };
}
