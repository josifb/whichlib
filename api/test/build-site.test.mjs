import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSite, dashboardForSite } from '../scripts/build-site.mjs';

const DASHBOARD = `<!doctype html>
<html lang="en">
<head>
<title>Fresh Repos</title>
<style>
</style>
</head>
<body>
<div class="wrap">
  <header class="top">
    <h1>Fresh Repos</h1>
  </header>
<style>
.later {}
</style>
<script src="../lib/score.js"></script>
</body>
</html>`;

test('dashboardForSite: loads /score.js, links to the site, keeps everything else', () => {
  const out = dashboardForSite(DASHBOARD);
  assert.match(out, /<script src="\/score\.js"><\/script>/);
  assert.doesNotMatch(out, /\.\.\/lib\/score\.js/);
  assert.match(out, /<p class="site-link"><a href="\/">whichlib<\/a> is the dependency picker for coding agents\./);
  assert.match(out, /<title>Fresh Repos · whichlib<\/title>/);
  assert.match(out, /\.site-link \{/);
  const link = out.indexOf('<p class="site-link">');
  assert.ok(link > out.indexOf('<header class="top">') && link < out.indexOf('</header>'));
  assert.doesNotMatch(out, /\n[ \t]+\n/);
  assert.ok(out.indexOf('.site-link {') < out.indexOf('</style>'));
  assert.ok(out.indexOf('.site-link {') < out.indexOf('.later'), 'CSS goes into the first style block');
  assert.match(out, /<h1>Fresh Repos<\/h1>/);
});

test('dashboardForSite: fails loudly when an anchor is missing (the dashboard changed)', () => {
  assert.throws(() => dashboardForSite(DASHBOARD.replace('<script src="../lib/score.js"></script>', '')), /score\.js/);
  assert.throws(() => dashboardForSite(DASHBOARD.replace('<header class="top">', '<header>')), /header/);
  assert.throws(() => dashboardForSite(DASHBOARD.replaceAll('</style>', '')), /style/);
  assert.throws(() => dashboardForSite(DASHBOARD.replace('<title>Fresh Repos</title>', '')), /title/);
});

test('buildSite: writes site/score.js and site/repos/index.html from the sources', () => {
  const root = mkdtempSync(join(tmpdir(), 'whichlib-site-'));
  try {
    mkdirSync(join(root, 'whichlib', 'lib'), { recursive: true });
    mkdirSync(join(root, 'whichlib', 'dashboard'), { recursive: true });
    writeFileSync(join(root, 'whichlib', 'lib', 'score.js'), '/* score */');
    writeFileSync(join(root, 'whichlib', 'dashboard', 'index.html'), DASHBOARD);
    buildSite({ root });
    assert.equal(readFileSync(join(root, 'site', 'score.js'), 'utf8'), '/* score */');
    assert.match(readFileSync(join(root, 'site', 'repos', 'index.html'), 'utf8'), /\/score\.js/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the real dashboard still has all four anchors', () => {
  const real = readFileSync(new URL('../../whichlib/dashboard/index.html', import.meta.url), 'utf8');
  assert.doesNotThrow(() => dashboardForSite(real));
});
