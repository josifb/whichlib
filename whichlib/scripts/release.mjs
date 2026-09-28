#!/usr/bin/env node
// Prepares a release: sets the version everywhere, runs the tests, commits
// and tags. Pushing the tag starts .github/workflows/release.yml, which
// publishes to npm, the MCP registry, Smithery and GitHub releases.
// Usage (from whichlib/): npm run release -- 0.1.2

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isNewerVersion, setPackageVersion } from './versions.mjs';

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const sh = (cmd) => execSync(cmd, { cwd: pkgDir, encoding: 'utf8' }).trim();
const fail = (msg) => { console.error(msg); process.exit(1); };

const version = process.argv[2];
if (!version) fail('Usage: npm run release -- <x.y.z>');
const current = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')).version;
if (!isNewerVersion(version, current)) fail(`${version} is not newer than the current ${current}.`);
if (sh('git branch --show-current') !== 'main') fail('Release from the main branch.');
if (sh('git status --porcelain')) fail('Commit or stash your changes first; the release commit should contain only the version bump.');
if (sh(`git tag --list v${version}`)) fail(`Tag v${version} already exists.`);

const changed = setPackageVersion(pkgDir, version);
execSync('npm test', { cwd: pkgDir, stdio: 'inherit' });
sh(`git add ${changed.map((f) => `"${f}"`).join(' ')}`);
sh(`git commit -m "chore: release ${version}"`);
sh(`git tag v${version}`);
console.log(`\nCommitted and tagged v${version}. To publish:\n\n  git push origin main v${version}\n`);
