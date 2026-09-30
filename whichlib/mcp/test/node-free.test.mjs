// The hosted Worker imports these modules. A Worker has no node:* built-ins
// (we do not enable nodejs_compat), so none of them may reach one through
// their relative imports. Packages (zod, the MCP SDK) are allowed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BUILTINS = /^(node:|fs$|fs\/|path$|os$|url$|child_process$|crypto$|http$|https$|stream$|util$)/;
const SPECIFIER = /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]/g;

export const WORKER_MODULES = [
  'mcp/tools.mjs',
  'mcp/expand.mjs',
  'mcp/github-api.mjs',
  'snapshot/src/registry.mjs',
  'lib/score.js',
];

function nodeImports(file, seen = new Set()) {
  if (seen.has(file)) return [];
  seen.add(file);
  const found = [];
  for (const m of readFileSync(file, 'utf8').matchAll(SPECIFIER)) {
    const spec = m[1] ?? m[2];
    if (BUILTINS.test(spec)) found.push(`${file.slice(PKG.length + 1)} -> ${spec}`);
    else if (spec.startsWith('.')) found.push(...nodeImports(resolve(dirname(file), spec), seen));
  }
  return found;
}

for (const mod of WORKER_MODULES) {
  test(`node-free: ${mod}`, () => {
    assert.deepEqual(nodeImports(join(PKG, mod)), []);
  });
}
