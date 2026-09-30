#!/usr/bin/env node
// Copies the daily snapshots and star counts from the `data` branch on origin
// into data/snapshots/ and data/stars/ without touching the index of the
// current branch.
// Usage: npm run pull-data

import { execFileSync } from 'node:child_process';
import { mkdir, writeFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
// Layout of the data branch: snapshots/<date>.json, stars/<date>.json, registry-map.json
const FOLDERS = ['snapshots', 'stars'];

const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });

git('fetch', '-q', 'origin', 'data');
for (const folder of FOLDERS) {
  const outDir = join(ROOT, 'data', folder);
  let listing = [];
  try {
    // --full-tree: without it, git scopes ls-tree to the current subdirectory and finds nothing.
    listing = git('ls-tree', '--full-tree', '--name-only', `origin/data:${folder}`).split('\n').filter((n) => n.endsWith('.json'));
  } catch {
    console.log(`${folder}/ not on the data branch yet`);
    continue;
  }
  await mkdir(outDir, { recursive: true });
  const have = new Set(await readdir(outDir));
  let copied = 0;
  for (const name of listing) {
    if (have.has(name)) continue;
    await writeFile(join(outDir, name), git('show', `origin/data:${folder}/${name}`));
    copied += 1;
  }
  console.log(`data branch has ${listing.length} file(s) in ${folder}/; copied ${copied} new to ${outDir}`);
}

// The rising list (repos of any age by stars gained this week) is rebuilt daily: always refresh it.
try {
  await writeFile(join(ROOT, 'data', 'rising.json'), git('show', 'origin/data:rising.json'));
  console.log('rising.json refreshed');
} catch {
  console.log('rising.json not on the data branch yet');
}

// The weekly gains summary (small precomputed file for the hosted Worker) is rebuilt daily: always refresh it.
try {
  await writeFile(join(ROOT, 'data', 'weekly-gains.json'), git('show', 'origin/data:weekly-gains.json'));
  console.log('weekly-gains.json refreshed');
} catch {
  console.log('weekly-gains.json not on the data branch yet');
}

// The registry map (repo -> package names) is small and changes daily: always refresh it.
try {
  const map = git('show', 'origin/data:registry-map.json');
  await writeFile(join(ROOT, 'data', 'registry-map.json'), map);
  console.log(`registry-map.json refreshed (${Object.keys(JSON.parse(map)).length} repos)`);
} catch {
  console.log('registry-map.json not on the data branch yet');
}
