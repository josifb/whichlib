#!/usr/bin/env node
// Renders site/og/card.html to site/og.png (1200x630, the share image every
// page names in og:image). Run by hand when the card changes, then commit the
// PNG; it is not part of [build]. Chrome: $CHROME or the Windows default.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CHROME = process.env.CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const SITE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'site');
const card = join(SITE, 'og', 'card.html');
const out = join(SITE, 'og.png');

const profile = mkdtempSync(join(tmpdir(), 'whichlib-og-'));
try {
  execFileSync(CHROME, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
    '--window-size=1200,630', `--user-data-dir=${profile}`, `--screenshot=${out}`, pathToFileURL(card).href,
  ], { stdio: 'inherit' });
} finally {
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
console.log(`og: ${out} rendered from ${card}`);
