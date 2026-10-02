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
const SITE_LINK = '    <p class="site-link"><a href="/">whichlib</a> is the dependency picker for coding agents. <a href="/#install">Install it</a> · <a href="/docs/">Docs</a></p>\n';

/** The dashboard as served at /repos/: scorer from /score.js and a line linking to the site. */
export function dashboardForSite(html) {
  for (const anchor of [SCRIPT_TAG, HEADER_TAG, '</header>', TITLE_TAG, STYLE_END]) {
    if (!html.includes(anchor)) throw new Error(`dashboard: "${anchor}" not found; update build-site.mjs`);
  }
  const headerEnd = html.indexOf('</header>', html.indexOf(HEADER_TAG));
  if (headerEnd === -1) throw new Error('dashboard: "</header>" after the header tag not found; update build-site.mjs');
  // Insert at the start of the </header> line so no whitespace-only line is left behind.
  const at = html.lastIndexOf('\n', headerEnd) + 1;
  return (html.slice(0, at) + SITE_LINK + html.slice(at))
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
