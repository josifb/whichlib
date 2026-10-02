import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSite } from '../scripts/build-site.mjs';

test('buildSite: copies score.js only and leaves site/repos/ alone', () => {
  const root = mkdtempSync(join(tmpdir(), 'whichlib-site-'));
  try {
    mkdirSync(join(root, 'whichlib', 'lib'), { recursive: true });
    mkdirSync(join(root, 'site'), { recursive: true });
    writeFileSync(join(root, 'whichlib', 'lib', 'score.js'), '/* score */');
    buildSite({ root });
    assert.equal(readFileSync(join(root, 'site', 'score.js'), 'utf8'), '/* score */');
    assert.ok(!existsSync(join(root, 'site', 'repos')), 'buildSite does not create or write site/repos/');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the dashboard source is site/repos/index.html: it loads /score.js and links to the site', () => {
  const html = readFileSync(new URL('../../site/repos/index.html', import.meta.url), 'utf8');
  assert.ok(html.includes('<script src="/score.js"></script>'));
  assert.ok(!html.includes('../lib/score.js'));
  assert.ok(html.includes('<p class="site-link"><a href="/">whichlib</a> is the dependency picker for coding agents.'));
});
