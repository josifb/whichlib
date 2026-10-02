// The hosted Worker imports these modules. A Worker has no node:* built-ins
// (we do not enable nodejs_compat), so none of them may reach one through
// their relative imports. Packages (zod, the MCP SDK) are allowed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BUILTINS = /^(node:|(fs|path|os|url|child_process|crypto|http|https|stream|util)(\/|$))/;
const SPECIFIER = /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]/g;
// Static require()/import() calls with a string-literal argument, e.g.
// require('node:fs') or await import('path/posix'). Specifiers built at
// runtime (non-literal import()/require() arguments) are not detected.
const DYNAMIC_SPECIFIER = /\b(?:require|import)\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
// Bare uses of Node-only globals that a Worker (no nodejs_compat) does not
// have. `globalThis.process` / `?.`-guarded access is fine and excluded by
// the lookbehind, since it requires the char right before the match not be
// part of an identifier, a dot or `$`.
const NODE_GLOBAL = /(?<![\w.$])(?:process\.|Buffer\b|__dirname\b|__filename\b)/g;
const LINE_COMMENT = /\/\/[^\n]*/g;
const BLOCK_COMMENT = /\/\*[\s\S]*?\*\//g;

export const WORKER_MODULES = [
  'mcp/tools.mjs',
  'mcp/expand.mjs',
  'mcp/github-api.mjs',
  'snapshot/src/registry.mjs',
  'lib/score.js',
  'snapshot/src/history-core.mjs',
  'snapshot/src/rising.mjs',
  'mcp/history-provider.mjs',
  'mcp/definitions.mjs',
  'mcp/jev.mjs',
  'snapshot/src/github.mjs',
  'snapshot/src/normalize.mjs',
  'snapshot/src/query.mjs',
];

function nodeImports(file, seen = new Set()) {
  if (seen.has(file)) return [];
  seen.add(file);
  const found = [];
  const source = readFileSync(file, 'utf8');
  const specs = [];
  for (const m of source.matchAll(SPECIFIER)) specs.push(m[1] ?? m[2]);
  for (const m of source.matchAll(DYNAMIC_SPECIFIER)) specs.push(m[1]);
  for (const spec of specs) {
    if (BUILTINS.test(spec)) found.push(`${file.slice(PKG.length + 1)} -> ${spec}`);
    else if (spec.startsWith('.')) found.push(...nodeImports(resolve(dirname(file), spec), seen));
  }
  return found;
}

// Bare Node-only globals in a file (comments stripped first, so a doc
// comment mentioning `process.env` does not trip it).
function nodeGlobalUses(file) {
  const source = readFileSync(file, 'utf8').replace(BLOCK_COMMENT, '').replace(LINE_COMMENT, '');
  const found = [];
  for (const m of source.matchAll(NODE_GLOBAL)) found.push(`${file.slice(PKG.length + 1)} -> ${m[0]}`);
  return found;
}

for (const mod of WORKER_MODULES) {
  test(`node-free: ${mod}`, () => {
    assert.deepEqual(nodeImports(join(PKG, mod)), []);
    assert.deepEqual(nodeGlobalUses(join(PKG, mod)), []);
  });
}

// Scans a fresh temp dir per test so files never collide between test cases.
function withTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'node-free-test-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('node-free: detects require("node:...")', () => {
  withTempDir((dir) => {
    const file = join(dir, 'a.mjs');
    writeFileSync(file, "const fs = require('node:fs');\n");
    const found = nodeImports(file);
    assert.equal(found.length, 1);
    assert.match(found[0], /node:fs/);
  });
});

test('node-free: detects dynamic import() of a built-in subpath', () => {
  withTempDir((dir) => {
    const file = join(dir, 'a.mjs');
    writeFileSync(file, "const m = await import('path/posix');\n");
    const found = nodeImports(file);
    assert.equal(found.length, 1);
    assert.match(found[0], /path\/posix/);
  });
});

test('node-free: recurses through export * to find a built-in subpath', () => {
  withTempDir((dir) => {
    const a = join(dir, 'a.mjs');
    const b = join(dir, 'b.mjs');
    writeFileSync(a, "export * from './b.mjs';\n");
    writeFileSync(b, "import 'stream/promises';\n");
    const found = nodeImports(a);
    assert.equal(found.length, 1);
    assert.match(found[0], /stream\/promises/);
  });
});

test('node-free: a clean file with no built-ins reports nothing', () => {
  withTempDir((dir) => {
    const file = join(dir, 'a.mjs');
    writeFileSync(file, "import { z } from 'zod';\nexport const x = 1;\n");
    assert.deepEqual(nodeImports(file), []);
  });
});

test('node-free: flags a bare process.env access', () => {
  withTempDir((dir) => {
    const file = join(dir, 'a.mjs');
    writeFileSync(file, "const t = process.env.X;\n");
    const found = nodeGlobalUses(file);
    assert.equal(found.length, 1);
    assert.match(found[0], /process\./);
  });
});

test('node-free: does not flag globalThis.process?. access', () => {
  withTempDir((dir) => {
    const file = join(dir, 'a.mjs');
    writeFileSync(file, "const t = globalThis.process?.env?.X;\n");
    assert.deepEqual(nodeGlobalUses(file), []);
  });
});

test('node-free: does not flag process.env mentioned only in a comment', () => {
  withTempDir((dir) => {
    const file = join(dir, 'a.mjs');
    writeFileSync(file, "// uses process.env\nexport const x = 1;\n");
    assert.deepEqual(nodeGlobalUses(file), []);
  });
});

test('node-free: flags Buffer.from', () => {
  withTempDir((dir) => {
    const file = join(dir, 'a.mjs');
    writeFileSync(file, "const b = Buffer.from('x');\n");
    const found = nodeGlobalUses(file);
    assert.equal(found.length, 1);
    assert.match(found[0], /Buffer\b/);
  });
});
