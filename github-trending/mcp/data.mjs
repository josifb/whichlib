// Optional snapshot history for the MCP server. When a snapshots folder is
// present (a repo clone after `npm run pull-data`, or FRESH_REPOS_DATA_DIR),
// momentum uses real 7-day stars gained. Otherwise every lookup yields null
// and the score falls back to stars per day since creation.

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSnapshots, buildHistory, starsGained } from '../snapshot/src/history.mjs';

const DEFAULT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'snapshots');

export const emptyHistory = { days: 0, latestDate: null, starsGained7d: () => null };

export async function loadHistoryProvider(dir = process.env.FRESH_REPOS_DATA_DIR || DEFAULT_DIR) {
  try {
    const snapshots = await loadSnapshots(dir);
    if (snapshots.length === 0) return emptyHistory;
    const history = buildHistory(snapshots);
    const latest = snapshots.at(-1);
    return {
      days: snapshots.length,
      latestDate: latest.date,
      starsGained7d: (fullName) => starsGained(history.get(fullName), 7, latest.date),
    };
  } catch {
    return emptyHistory;
  }
}
