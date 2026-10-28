// Renders version cards from breaking-change indexes: per package one header
// line, then the breaking changes since the version the agent likely knows,
// most important first, each with its version and source link. Node-free.

import { compareVersions } from './version.mjs';

const MAX_BULLET = 200;

function short(s) {
  if (s.length <= MAX_BULLET) return s;
  const space = s.lastIndexOf(' ', MAX_BULLET - 1);
  return s.slice(0, space > 100 ? space : MAX_BULLET - 1) + '…';
}
const bullet = (e) => `- ${short(e.prose && e.section ? `${e.section}: ${e.text}` : e.text)} (${e.version}, ${e.source})`;

/** The breaking entries after `index.from` up to `version`, most likely breaking first. */
function breakingSince(index, version) {
  return index.entries
    .filter((e) => e.p >= index.threshold && compareVersions(e.version, version) <= 0)
    .sort((a, b) => b.p - a.p || compareVersions(a.version, b.version));
}

function card(request, indexes) {
  const { package: pkg, version } = request;
  const index = indexes.find((i) => i.package === pkg);
  if (!index) return { head: [`## ${pkg} ${version}: not covered by whichlib, no version card. This does not mean nothing changed.`], bullets: [] };
  if (!index.versions.some((v) => compareVersions(v, version) === 0)) {
    return { head: [`## ${pkg} ${version}: unknown version (whichlib covers ${index.from} to ${index.to}). This does not mean nothing changed; check the release notes.`], bullets: [] };
  }
  const head = [`## ${pkg} ${version} installed (you likely know ${index.from})`];
  if (compareVersions(version, index.from) <= 0) return { head: [...head, `No changes to note: ${version} is not newer than ${index.from}.`], bullets: [] };
  const bullets = breakingSince(index, version).map(bullet);
  if (!bullets.length) return { head: [...head, `No breaking changes found since ${index.from}.`], bullets };
  return { head: [...head, `Breaking changes since ${index.from}, most important first:`], bullets };
}

/** Rough token count (about 4 characters per token). */
export const estimateTokens = (text) => Math.ceil(text.length / 4);

/**
 * versionCards(requests, indexes, { maxTokens }) -> card set text.
 * requests: [{ package, version }]; indexes: from buildIndex. Over maxTokens,
 * the least important bullets of the longest cards go first, and each trimmed
 * card says how many were left out.
 */
export function versionCards(requests, indexes, { maxTokens = 1500 } = {}) {
  const cards = requests.map((r) => ({ ...card(r, indexes), dropped: 0 }));
  const render = () => cards.map((c) => [
    ...c.head,
    ...c.bullets,
    ...(c.dropped ? [`- (trimmed: ${c.dropped} more breaking change${c.dropped === 1 ? '' : 's'} not shown, see the release notes)`] : []),
  ].join('\n')).join('\n\n');
  let text = render();
  while (estimateTokens(text) > maxTokens) {
    const longest = cards.reduce((a, b) => (b.bullets.length > a.bullets.length ? b : a));
    if (!longest.bullets.length) break;
    longest.bullets.pop();
    longest.dropped++;
    text = render();
  }
  return text;
}
