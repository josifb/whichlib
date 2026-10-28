// Builds the breaking-change index of one package: collects the changelog
// entries of every version after `from` up to `to` from its sources, has the
// judge rate each entry once (answers kept in `cache`), and returns plain JSON.
// No Node built-ins: fetching is done by the injected `sources`.

import { changelogEntries, notesEntries } from './entries.mjs';
import { compareVersions, inRange, parseVersion } from './version.mjs';

export const THRESHOLD = 0.3; // chosen for recall on real changelog entries, with the model pinned in breaking.mjs

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** "langchain=={version}" -> version from a release tag, or null. */
function tagVersion(tag, pattern) {
  if (!pattern.includes('{version}')) throw new Error(`release tag pattern needs {version}: ${pattern}`);
  const [pre, post] = pattern.split('{version}');
  const m = new RegExp(`^${escape(pre)}(.+)${escape(post)}$`).exec(tag);
  return m && parseVersion(m[1]) ? m[1] : null;
}

async function collect(source, sources) {
  if (source.kind === 'changelog' || source.kind === 'guide') {
    const { text, url } = await sources.file(source.repo, source.path);
    const format = source.path.endsWith('.rst') ? 'rst' : 'md';
    const entries = source.kind === 'guide' ? notesEntries(text, source.version, { format }) : changelogEntries(text, { format });
    return entries.map(({ line, ...e }) => ({ ...e, source: `${url}#L${line}` }));
  }
  if (source.kind === 'releases') {
    const out = [];
    for (const r of await sources.releases(source.repo)) {
      const version = r.prerelease ? null : tagVersion(r.tag, source.tag ?? 'v{version}');
      if (version) out.push(...notesEntries(r.body, version, { lines: true }).map(({ line, ...e }) => ({ ...e, source: r.url })));
    }
    return out;
  }
  throw new Error(`unknown source kind: ${source.kind}`);
}

/** Cache key: everything the judge sees, so a changed entry is judged again. */
export const cacheKey = (model, pkg, e) => JSON.stringify([model ?? '', pkg, e.section, e.text]);

/**
 * buildIndex(library, { sources, judge, cache }) -> index.
 * library: { package, ecosystem, from, to, sources: [{ kind: 'changelog'|'guide'|'releases', repo, path?, version?, tag? }] }
 * sources: { versions(pkg, ecosystem), file(repo, path) -> {text, url}, releases(repo) -> [{tag, url, body, prerelease}] }
 * judge(pkg, entries) -> probabilities (same order); judge.model names the model for the cache.
 * cache: plain object, read and filled in place.
 */
export async function buildIndex(library, { sources, judge, cache = {} }) {
  const { package: pkg, ecosystem, from, to } = library;
  const versions = (await sources.versions(pkg, ecosystem))
    .filter((v) => parseVersion(v) && compareVersions(v, from) >= 0 && compareVersions(v, to) <= 0)
    .sort(compareVersions);

  const seen = new Set();
  const entries = [];
  for (const source of library.sources) {
    for (const e of await collect(source, sources)) {
      if (!inRange(e.version, from, to)) continue;
      const k = e.text.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      entries.push(e);
    }
  }

  const todo = entries.filter((e) => !(cacheKey(judge.model, pkg, e) in cache));
  if (todo.length) {
    const ps = await judge(pkg, todo);
    todo.forEach((e, i) => { cache[cacheKey(judge.model, pkg, e)] = ps[i]; });
  }
  return {
    package: pkg,
    ecosystem,
    from,
    to,
    versions,
    model: judge.model ?? null,
    threshold: THRESHOLD,
    entries: entries.map((e) => ({ ...e, p: cache[cacheKey(judge.model, pkg, e)] })),
  };
}
