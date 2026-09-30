import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { toolDefinitions, LOCAL_LIMIT_NOTE, HOSTED_LIMIT_NOTE } from '../definitions.mjs';

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

test('toolDefinitions: input schemas validate and apply defaults', () => {
  const [recommend, compare, trending] = toolDefinitions();
  assert.deepEqual(z.object(recommend.config.inputSchema).parse({ need: 'pdf parser' }), { need: 'pdf parser', limit: 5 });
  assert.throws(() => z.object(compare.config.inputSchema).parse({ repos: ['a/b'] }));
  const t = z.object(trending.config.inputSchema).parse({ period: 'rising' });
  assert.equal(t.limit, 20);
  assert.equal(t.withDownloads, false);
});
