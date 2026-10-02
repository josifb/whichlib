#!/usr/bin/env node
// Runs before every `wrangler dev` / `wrangler deploy` ([build] in wrangler.toml).
// Each source exists once: the score lives in whichlib/lib/score.js and the
// dashboard in whichlib/dashboard/index.html; the site gets generated copies
// (git-ignored): site/score.js and site/repos/index.html.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_TAG = '<script src="../lib/score.js"></script>';
const HEADER_TAG = '<header class="top">';
const TITLE_TAG = '<title>Fresh Repos</title>';
const STYLE_END = '</style>';
const SITE_LINK_CSS = '  .site-link { flex-basis: 100%; margin: 4px 0 0; color: var(--muted); font-size: 13px; }\n  .site-link a { color: var(--accent); }\n';
const SITE_LINK = '\n    <p class="site-link">Part of <a href="/">whichlib</a>, the dependency picker for coding agents. <a href="/#install">Install it</a> · <a href="/docs/">Docs</a></p>';

/** The dashboard as served at /repos/: scorer from /score.js and a line linking to the site. */
export function dashboardForSite(html) {
  if (!html.includes(SCRIPT_TAG)) throw new Error(`dashboard: "${SCRIPT_TAG}" not found; update build-site.mjs`);
  const headerEnd = html.indexOf('</header>', html.indexOf(HEADER_TAG));
  if (!html.includes(HEADER_TAG) || headerEnd === -1) throw new Error(`dashboard: "${HEADER_TAG}" ... "</header>" not found; update build-site.mjs`);
  if (!html.includes(STYLE_END)) throw new Error('dashboard: "</style>" not found; update build-site.mjs');
  const withLink = html.slice(0, headerEnd) + SITE_LINK.trimEnd() + '\n  ' + html.slice(headerEnd);
  return withLink
    .replace(SCRIPT_TAG, '<script src="/score.js"></script>')
    .replace(TITLE_TAG, '<title>Fresh Repos · whichlib</title>')
    .replace(STYLE_END, SITE_LINK_CSS + STYLE_END);
}

/** root: the public repo root (the folder holding whichlib/, site/ and api/). */
export function buildSite({ root }) {
  mkdirSync(join(root, 'site', 'repos'), { recursive: true });
  copyFileSync(join(root, 'whichlib', 'lib', 'score.js'), join(root, 'site', 'score.js'));
  const dashboard = readFileSync(join(root, 'whichlib', 'dashboard', 'index.html'), 'utf8');
  writeFileSync(join(root, 'site', 'repos', 'index.html'), dashboardForSite(dashboard));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  buildSite({ root: join(dirname(fileURLToPath(import.meta.url)), '..', '..') });
  console.log('site: score.js and repos/index.html built');
}
