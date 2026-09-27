#!/usr/bin/env node
// Enriches the latest snapshot with npm / PyPI packages and weekly downloads.
// Rewrites data/snapshots/<latest>.json in place and maintains
// data/registry-map.json (repo -> package names, cached across days).
// Usage: node snapshot/src/enrich.mjs [YYYY-MM-DD]

import { readFile, writeFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolvePackages, registriesFor } from './registry.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SNAP_DIR = join(ROOT, 'data', 'snapshots');
const MAP_PATH = join(ROOT, 'data', 'registry-map.json');
const CONCURRENCY = 4;

async function readJson(path, fallback) {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch (err) { if (err.code === 'ENOENT') return fallback; throw err; }
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }));
  return results;
}

const requested = process.argv[2];
const files = (await readdir(SNAP_DIR)).filter((n) => /^\d{4}-\d{2}-\d{2}\.json$/.test(n)).sort();
const file = requested ? `${requested}.json` : files.at(-1);
if (!file || !files.includes(file)) {
  console.error(requested ? `No snapshot for ${requested}.` : 'No snapshots found. Run `npm run snapshot` first.');
  process.exit(1);
}

const snapPath = join(SNAP_DIR, file);
const snapshot = await readJson(snapPath);
const cache = await readJson(MAP_PATH, {});
const now = Date.now();

// Unique repos across every period x language result, keeping one record per repo.
const repos = new Map();
for (const result of snapshot.results) for (const item of result.items) if (!repos.has(item.fullName)) repos.set(item.fullName, item);
const eligible = [...repos.values()].filter((r) => registriesFor(r.language).length > 0);

console.log(`Enrich ${file}: ${repos.size} unique repos, ${eligible.length} eligible for npm/PyPI lookup, ${Object.keys(cache).length} cached mappings`);

const failures = [];
const resolved = new Map();
await mapLimit(eligible, CONCURRENCY, async (repo) => {
  try {
    resolved.set(repo.fullName, await resolvePackages(repo, { cache, now }));
  } catch (err) {
    failures.push(`${repo.fullName}: ${err.message}`);
    resolved.set(repo.fullName, []);
  }
});

let mapped = 0;
for (const result of snapshot.results) {
  for (const item of result.items) {
    const packages = resolved.get(item.fullName) ?? [];
    item.packages = packages;
    const known = packages.filter((p) => typeof p.weeklyDownloads === 'number');
    item.weeklyDownloads = known.length ? known.reduce((s, p) => s + p.weeklyDownloads, 0) : null;
  }
}
for (const [, pk] of resolved) if (pk.length) mapped += 1;

snapshot.enrichedAt = new Date(now).toISOString();
await writeFile(snapPath, JSON.stringify(snapshot, null, 1));
await writeFile(MAP_PATH, JSON.stringify(cache, null, 1));

const byRegistry = { npm: 0, pypi: 0 };
for (const [, pk] of resolved) for (const p of pk) byRegistry[p.registry] += 1;
console.log(`Mapped ${mapped}/${eligible.length} repos (npm ${byRegistry.npm}, pypi ${byRegistry.pypi}); ${failures.length} lookup failure(s)`);
for (const f of failures.slice(0, 10)) console.log(`  ! ${f}`);
console.log(`Wrote ${snapPath} and ${MAP_PATH}`);
