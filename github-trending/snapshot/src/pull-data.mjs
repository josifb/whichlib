#!/usr/bin/env node
// Copies the daily snapshots from the `data` branch on origin into
// data/snapshots/ without touching the index of the current branch.
// Usage: npm run pull-data

import { execFileSync } from 'node:child_process';
import { mkdir, writeFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT_DIR = join(ROOT, 'data', 'snapshots');
const BRANCH_PATH = 'github-trending/data/snapshots';

const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

git('fetch', '-q', 'origin', 'data');
const listing = git('ls-tree', '--name-only', `origin/data:${BRANCH_PATH}`).split('\n').filter((n) => n.endsWith('.json'));

await mkdir(OUT_DIR, { recursive: true });
const have = new Set(await readdir(OUT_DIR));
let copied = 0;
for (const name of listing) {
  if (have.has(name)) continue;
  const content = git('show', `origin/data:${BRANCH_PATH}/${name}`);
  await writeFile(join(OUT_DIR, name), content);
  copied += 1;
}
console.log(`data branch has ${listing.length} snapshot(s); copied ${copied} new file(s) to ${OUT_DIR}`);
