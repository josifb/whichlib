// Ranking metrics for the recommendation eval. A "hit" is a ranked repo whose
// full name (case-insensitive) is in the accepted set for the need.

export const norm = (name) => String(name).toLowerCase();

/** 1-based rank of the first accepted repo in `ranked`, or null. */
export function firstHitRank(ranked, accept) {
  const ok = new Set(accept.map(norm));
  const i = ranked.findIndex((name) => ok.has(norm(name)));
  return i === -1 ? null : i + 1;
}

/** Aggregate over needs: hit@1, hit@3, hit@5 (fractions) and MRR. `ranks` holds firstHitRank per need. */
export function summarize(ranks) {
  const n = ranks.length;
  if (n === 0) return { n: 0, hitAt1: 0, hitAt3: 0, hitAt5: 0, mrr: 0 };
  const within = (k) => ranks.filter((r) => r !== null && r <= k).length / n;
  const mrr = ranks.reduce((s, r) => s + (r === null ? 0 : 1 / r), 0) / n;
  return { n, hitAt1: within(1), hitAt3: within(3), hitAt5: within(5), mrr };
}

export const pct = (x) => `${Math.round(x * 100)}%`;
