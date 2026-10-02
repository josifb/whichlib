// Static checks for the hand-written pages in site/ (the generated /repos/
// and /score.js are covered by build-site.test.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DAILY_LIMIT, BURST_LIMIT } from '../src/limits.mjs';

const { WEIGHTS } = createRequire(import.meta.url)('../../whichlib/lib/score.js');

const SITE = fileURLToPath(new URL('../../site/', import.meta.url));
const PAGES = { '/': 'index.html', '/docs/': 'docs/index.html', '/pricing/': 'pricing/index.html', '/404': '404.html' };
const GENERATED = new Set(['/score.js', '/repos/']);
const read = (file) => readFileSync(join(SITE, file), 'utf8');
const nav = (html) => html.match(/<nav class="site-nav"[\s\S]*?<\/nav>/)?.[0];
const footer = (html) => html.match(/<footer class="site-footer"[\s\S]*?<\/footer>/)?.[0];

/** An internal href/src ("/docs/", "/style.css", "/#install") -> the file that serves it, or null when generated. */
function targetFile(path) {
  const clean = path.split('#')[0].split('?')[0] || '/';
  if (GENERATED.has(clean)) return null;
  if (clean.endsWith('/')) return join(clean.slice(1), 'index.html');
  return clean.slice(1);
}

for (const [route, file] of Object.entries(PAGES)) {
  test(`${route}: head has title, description, viewport, Open Graph and the stylesheet`, () => {
    const html = read(file);
    assert.match(html, /^<!doctype html>/i);
    assert.match(html, /<html lang="en">/);
    assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1/);
    assert.match(html, /<title>[^<]{5,70}<\/title>/);
    assert.match(html, /<meta name="description" content="[^"]{30,170}">/);
    for (const p of ['og:title', 'og:description', 'og:type', 'og:url']) assert.match(html, new RegExp(`<meta property="${p}" content="[^"]+">`), p);
    assert.match(html, /<link rel="stylesheet" href="\/style\.css">/);
  });

  test(`${route}: same header nav and footer as the home page`, () => {
    const home = read('index.html');
    assert.ok(nav(home) && footer(home), 'home has nav and footer');
    // aria-current differs per page; compare without it
    const plain = (s) => s.replace(/ aria-current="page"/g, '');
    assert.equal(plain(nav(read(file))), plain(nav(home)));
    assert.equal(footer(read(file)), footer(home));
  });

  test(`${route}: every internal link and asset exists`, () => {
    const html = read(file);
    for (const [, path] of html.matchAll(/(?:href|src)="(\/[^"]*)"/g)) {
      const target = targetFile(path);
      if (target) assert.ok(existsSync(join(SITE, target)), `${route} links to ${path}, missing ${target}`);
    }
  });

  test(`${route}: scripts only from this site`, () => {
    for (const [, src] of read(file).matchAll(/<script[^>]*src="([^"]+)"/g)) assert.ok(src.startsWith('/'), `external script ${src}`);
  });
}

test('nav links: Home, Dashboard, Docs, Pricing, GitHub; footer: MIT, privacy, waitlist', () => {
  const n = nav(read('index.html'));
  for (const href of ['href="/"', 'href="/repos/"', 'href="/docs/"', 'href="/pricing/"', 'href="https://github.com/josifb/whichlib"']) assert.ok(n.includes(href), href);
  const f = footer(read('index.html'));
  for (const s of ['MIT', 'https://github.com/josifb/whichlib/blob/main/PRIVACY.md', 'https://github.com/josifb/whichlib/issues/1']) assert.ok(f.includes(s), s);
});

test('each page marks itself current in the nav', () => {
  assert.match(nav(read('index.html')), /<a href="\/" aria-current="page">/);
  assert.match(nav(read('docs/index.html')), /<a href="\/docs\/" aria-current="page">/);
  assert.match(nav(read('pricing/index.html')), /<a href="\/pricing\/" aria-current="page">/);
});

test('home: dated real example, the three install options with copy buttons, waitlist', () => {
  const html = read('index.html');
  for (const s of ['psf/requests', 'aio-libs/aiohttp', 'encode/httpx', '2026-10-02']) assert.ok(html.includes(s), s);
  assert.ok(html.includes('id="install"'));
  for (const s of ['claude mcp add --transport http whichlib https://whichlib.com/mcp', '/plugin marketplace add josifb/whichlib', 'claude mcp add whichlib -- npx -y whichlib']) assert.ok(html.includes(s), s);
  assert.ok((html.match(/data-copy/g) ?? []).length >= 3);
  assert.ok(html.includes('https://github.com/josifb/whichlib/issues/1'));
  assert.match(html, /<script src="\/site\.js" defer><\/script>/);
});

test('docs: tools, web API with curl, score and tiers, limits, own token, MCP Accept header, privacy', () => {
  const html = read('docs/index.html');
  for (const s of ['recommend_repos', 'compare_repos', 'trending_repos', '/api/recommend', '/api/compare', '/api/trending', 'curl ',
    'Strong', 'Solid', 'Watch', 'Avoid', '<strong>New</strong>', 'X-GitHub-Token', 'X-RateLimit-Remaining', 'application/json, text/event-stream', 'id="privacy"']) {
    assert.ok(html.includes(s), s);
  }
  // facts tied to the code, so a changed limit or weight fails here
  for (const s of [`${DAILY_LIMIT} tool calls`, `${BURST_LIMIT} per minute`, ...Object.values(WEIGHTS).map((w) => `${Math.round(w * 100)}%`)]) assert.ok(html.includes(s), s);
});

test('pricing: free, own token, teams waitlist', () => {
  const html = read('pricing/index.html');
  for (const s of [`${DAILY_LIMIT}`, 'X-GitHub-Token', 'Teams', 'https://github.com/josifb/whichlib/issues/1']) assert.ok(html.includes(s), s);
});

test('sitemap lists the four pages; robots points at it; llms.txt links the docs', () => {
  const sitemap = read('sitemap.xml');
  for (const p of ['https://whichlib.com/', 'https://whichlib.com/repos/', 'https://whichlib.com/docs/', 'https://whichlib.com/pricing/']) assert.ok(sitemap.includes(`<loc>${p}</loc>`), p);
  assert.match(read('robots.txt'), /Sitemap: https:\/\/whichlib\.com\/sitemap\.xml/);
  const llms = read('llms.txt');
  assert.match(llms, /^# whichlib/);
  assert.ok(llms.includes('https://whichlib.com/docs/'));
});

test('no workers.dev address anywhere in site/ (listings and pages only ever name whichlib.com)', () => {
  for (const file of [...Object.values(PAGES), 'sitemap.xml', 'robots.txt', 'llms.txt', 'site.js', 'style.css']) {
    assert.doesNotMatch(read(file), /workers\.dev/, file);
  }
});

test('every hand-written file is tracked by git (an ignore rule must not hide one)', () => {
  for (const file of [...Object.values(PAGES), 'sitemap.xml', 'robots.txt', 'llms.txt', 'site.js', 'style.css']) {
    assert.doesNotThrow(() => execFileSync('git', ['ls-files', '--error-unmatch', file], { cwd: SITE, stdio: 'pipe' }), file);
  }
});

for (const [route, file] of Object.entries(PAGES)) {
  test(`${route}: data-copy and aria-controls point at ids on the page; no panel is hidden in the HTML`, () => {
    const html = read(file);
    const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
    for (const [, id] of html.matchAll(/data-copy="([^"]+)"/g)) assert.ok(ids.has(id), `data-copy ${id}`);
    for (const [, id] of html.matchAll(/aria-controls="([^"]+)"/g)) assert.ok(ids.has(id), `aria-controls ${id}`);
    assert.doesNotMatch(html, /role="tabpanel"[^>]*\shidden/, 'panels are hidden by site.js, not the markup');
  });
}
