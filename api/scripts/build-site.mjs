#!/usr/bin/env node
// Runs before every `wrangler dev` / `wrangler deploy` ([build] in wrangler.toml).
// The score lives once in whichlib/lib/score.js; the site gets a generated copy
// (git-ignored): site/score.js. The dashboard source is site/repos/index.html.
import { copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** root: the public repo root (the folder holding whichlib/, site/ and api/). */
export function buildSite({ root }) {
  copyFileSync(join(root, 'whichlib', 'lib', 'score.js'), join(root, 'site', 'score.js'));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  buildSite({ root: join(dirname(fileURLToPath(import.meta.url)), '..', '..') });
  console.log('site: score.js built');
}
