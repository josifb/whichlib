import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const toml = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');

test('wrangler.toml: workers.dev and preview URLs are off, whichlib.com is the custom domain', () => {
  assert.match(toml, /^workers_dev = false\r?$/m);
  assert.match(toml, /^preview_urls = false\r?$/m);
  assert.match(toml, /{ pattern = "whichlib.com", custom_domain = true }/);
});
