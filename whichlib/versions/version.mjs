// Version ordering for npm (semver) and PyPI (PEP 440 subset) release numbers:
// 2.0 == 2.0.0, prereleases (alpha/beta/rc, 1.0.0-beta.3, 1.0.0rc2) sort
// before their final release (an unknown tag such as -experimental counts as
// alpha), .post releases after it; +build metadata is ignored.

const PRE_RANK = { dev: 0, canary: 1, next: 1, a: 1, alpha: 1, b: 2, beta: 2, c: 3, rc: 3, pre: 3 };
const UNKNOWN_PRE = 1;
const FINAL = 4;
const POST = 5;
const VERSION = /^v?(\d+(?:\.\d+)*)(?:[-.]?(dev|canary|next|alpha|beta|pre|post|rc|a|b|c)[-.]?(\d+)?)?(.*)$/i;

/** Parsed version or null when the string is not a version. */
export function parseVersion(v) {
  const m = VERSION.exec(String(v).trim());
  if (!m) return null;
  const tag = m[2]?.toLowerCase();
  const rest = m[4];
  let rank;
  if (tag !== undefined) rank = tag === 'post' ? POST : PRE_RANK[tag];
  else if (rest === '' || rest.startsWith('+')) rank = FINAL;
  else if (rest.startsWith('-')) rank = UNKNOWN_PRE;
  else return null;
  return { release: m[1].split('.').map(Number), rank, n: Number(m[3] ?? 0) };
}

/** Negative when a < b, 0 when equal, positive when a > b. Throws on a non-version. */
export function compareVersions(a, b) {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) throw new Error(`not a version: ${!x ? a : b}`);
  const len = Math.max(x.release.length, y.release.length);
  for (let i = 0; i < len; i++) {
    const d = (x.release[i] ?? 0) - (y.release[i] ?? 0);
    if (d) return d;
  }
  return x.rank - y.rank || x.n - y.n;
}

/** True when from < v <= to. */
export const inRange = (v, from, to) => compareVersions(v, from) > 0 && compareVersions(v, to) <= 0;
