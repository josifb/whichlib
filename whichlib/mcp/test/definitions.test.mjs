import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { toolDefinitions, LOCAL_LIMIT_NOTE, HOSTED_LIMIT_NOTE, inputObject } from '../definitions.mjs';

test('toolDefinitions: the three tools, read-only annotations', () => {
  const defs = toolDefinitions();
  assert.deepEqual(defs.map((d) => d.name), ['recommend_repos', 'compare_repos', 'trending_repos']);
  for (const d of defs) {
    assert.ok(d.config.title && d.config.description && d.config.inputSchema);
    assert.deepEqual(d.config.annotations, { readOnlyHint: true, openWorldHint: true });
  }
});

test('toolDefinitions: each tool gets its own annotations object, not a shared reference', () => {
  const defs = toolDefinitions();
  assert.notEqual(defs[0].config.annotations, defs[1].config.annotations);
  const again = toolDefinitions();
  assert.notEqual(defs[0].config.annotations, again[0].config.annotations);
});

test('toolDefinitions: the limit sentence is a parameter (local by default, hosted on request)', () => {
  const local = toolDefinitions();
  const hosted = toolDefinitions({ limitNote: HOSTED_LIMIT_NOTE });
  for (const name of ['recommend_repos', 'trending_repos']) {
    assert.ok(local.find((d) => d.name === name).config.description.includes(LOCAL_LIMIT_NOTE));
    const h = hosted.find((d) => d.name === name).config.description;
    assert.ok(h.includes(HOSTED_LIMIT_NOTE));
    assert.ok(!h.includes(LOCAL_LIMIT_NOTE));
  }
  assert.match(HOSTED_LIMIT_NOTE, /50/);
  assert.match(HOSTED_LIMIT_NOTE, /X-GitHub-Token/);
});

test('toolDefinitions: input schemas are zod objects (MCP SDK v2 takes a schema, not a raw shape)', () => {
  for (const d of toolDefinitions()) assert.ok(d.config.inputSchema instanceof z.ZodObject, d.name);
});

test('toolDefinitions: input schemas validate and apply defaults', () => {
  const [recommend, compare, trending] = toolDefinitions();
  assert.deepEqual(recommend.config.inputSchema.parse({ need: 'pdf parser' }), { need: 'pdf parser', limit: 5 });
  assert.throws(() => compare.config.inputSchema.parse({ repos: ['a/b'] }));
  const t = trending.config.inputSchema.parse({ period: 'rising' });
  assert.equal(t.limit, 20);
  assert.equal(t.withDownloads, false);
});

test('compareNote is appended to the compare description only', () => {
  const plain = toolDefinitions();
  const hosted = toolDefinitions({ limitNote: HOSTED_LIMIT_NOTE, compareNote: HOSTED_LIMIT_NOTE });
  const compare = (defs) => defs.find((d) => d.name === 'compare_repos').config.description;
  assert.ok(!compare(plain).includes(HOSTED_LIMIT_NOTE));
  assert.ok(compare(hosted).endsWith(` ${HOSTED_LIMIT_NOTE}`));
});

test('inputObject validates and applies defaults with the definition schema', () => {
  const trending = toolDefinitions().find((d) => d.name === 'trending_repos');
  const ok = inputObject(trending).safeParse({ period: 'day' });
  assert.equal(ok.success, true);
  assert.deepEqual(ok.data, { period: 'day', limit: 20, withDownloads: false });
  assert.equal(inputObject(trending).safeParse({ limit: 500 }).success, false);
});
