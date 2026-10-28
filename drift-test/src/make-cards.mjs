#!/usr/bin/env node
// npm run cards -- [--only zod,vite] [--render-only]
// Builds the whichlib version cards for the Drift Test from the real pipeline:
// release notes, changelogs and migration guides (cards/libraries.json), each
// entry judged once by Jev. Writes cards/index/<package>.json (every entry with
// its source and Jev probability) and cards/<package>.md (the card the runner
// gives the agent). Saved judgments are reused, so a rerun makes no new Jev calls.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { buildIndex, cacheKey } from '../../whichlib/versions/build.mjs';
import { createBreakingJudge } from '../../whichlib/versions/breaking.mjs';
import { createSources } from '../../whichlib/versions/sources.mjs';
import { estimateTokens, versionCards } from '../../whichlib/versions/card.mjs';
import { JEV_MODEL, JevError } from '../../whichlib/mcp/jev.mjs';

const cardsDir = join(dirname(dirname(fileURLToPath(import.meta.url))), 'cards');
const indexDir = join(cardsDir, 'index');
const SLICE = 100; // entries per judge call: 5 requests of 20 in flight
const log = (...a) => console.error(...a);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const { values } = parseArgs({
  options: { only: { type: 'string' }, 'render-only': { type: 'boolean', default: false }, help: { type: 'boolean', default: false } },
});
if (values.help) {
  console.log(`npm run cards -- [--only zod,vite] [--render-only]
  --only <list>    build only these packages (default: all in cards/libraries.json)
  --render-only    rewrite the cards from the saved cards/index/*.json, no network
Needs GITHUB_TOKEN (for example "$(gh auth token)"), and TYPESAFE_API_KEY when an entry has no saved judgment.`);
  process.exit(0);
}

/** Jev judge for a batch run: slices of SLICE entries, retries on rate limits, 5xx and timeouts. Needs the key only when called. */
function batchJudge() {
  let inner = null;
  const judge = async (pkg, entries) => {
    if (!process.env.TYPESAFE_API_KEY) throw new Error(`${entries.length} ${pkg} entries need a Jev judgment: set TYPESAFE_API_KEY`);
    inner ??= createBreakingJudge({ apiKey: process.env.TYPESAFE_API_KEY });
    const out = [];
    for (let i = 0; i < entries.length; i += SLICE) {
      for (let attempt = 1; ; attempt++) {
        try {
          out.push(...await inner(pkg, entries.slice(i, i + SLICE)));
          break;
        } catch (err) {
          const retry = err instanceof JevError && (err.status === null || err.status === 429 || err.status >= 500);
          if (!retry || attempt === 5) throw err;
          log(`  jev: ${err.message}, retry ${attempt} in ${2 ** attempt} s`);
          await wait(2 ** attempt * 1000);
        }
      }
      log(`  jev: ${Math.min(i + SLICE, entries.length)}/${entries.length} judged`);
    }
    return out;
  };
  judge.model = JEV_MODEL;
  return judge;
}

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));

const { libraries } = await readJson(join(cardsDir, 'libraries.json'));
const only = values.only && [...new Set(values.only.split(',').map((s) => s.trim()))];
const chosen = only ? libraries.filter((l) => only.includes(l.package)) : libraries;
if (only && chosen.length !== only.length) throw new Error(`unknown package in --only: ${only.filter((p) => !libraries.some((l) => l.package === p)).join(', ')}`);

await mkdir(indexDir, { recursive: true });
const sources = createSources({ token: process.env.GITHUB_TOKEN || null });
const judge = batchJudge();

for (const library of chosen) {
  const indexPath = join(indexDir, `${library.package}.json`);
  const saved = existsSync(indexPath) ? await readJson(indexPath) : null;
  let index;
  if (values['render-only']) {
    if (!saved) throw new Error(`no saved index for ${library.package}: run without --render-only first`);
    index = saved;
  } else {
    log(`${library.package}: collecting ${library.from} -> ${library.to}`);
    // Saved judgments are the cache: same model, package, section and text -> same answer.
    const cache = {};
    for (const e of saved?.entries ?? []) cache[cacheKey(saved.model, saved.package, e)] = e.p;
    index = await buildIndex(library, { sources, judge, cache });
    for (const v of [library.from, library.to]) {
      if (!index.versions.includes(v)) throw new Error(`${library.package} ${v} is not a published version`);
    }
    await writeFile(indexPath, JSON.stringify(index, null, 1) + '\n');
  }
  const cardText = versionCards([{ package: library.package, version: library.to }], [index]);
  await writeFile(join(cardsDir, `${library.package}.md`), cardText + '\n');
  const breakingCount = index.entries.filter((e) => e.p >= index.threshold).length;
  log(`${library.package}: ${index.entries.length} entries, ${breakingCount} breaking, card ~${estimateTokens(cardText)} tokens`);
}
