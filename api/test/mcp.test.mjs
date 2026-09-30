import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { handleMcp } from '../src/mcp.mjs';
import { HostedError, HOSTED_DEFINITIONS } from '../src/service.mjs';

const anon = { ip: '1.2.3.4', ownToken: null };
const RESULT = { tool: 'compare_repos', requested: ['a/b', 'c/d'], generatedAt: '2026-10-01T00:00:00Z', dataNotes: [], repos: [], notFound: [] };

async function connect(service, caller = anon) {
  const client = new Client({ name: 't', version: '0' });
  const transport = new StreamableHTTPClientTransport(new URL('https://w.test/mcp'), {
    fetch: (url, init) => handleMcp(new Request(url, init), service, caller),
  });
  await client.connect(transport);
  return client;
}

test('initialize and tools/list: the three hosted definitions', async () => {
  const client = await connect({ call: async () => ({ result: RESULT, quota: null }) });
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), ['compare_repos', 'recommend_repos', 'trending_repos']);
  for (const t of tools) assert.equal(t.description, HOSTED_DEFINITIONS.find((d) => d.name === t.name).config.description);
  await client.close();
});

test('tools/call: text plus structuredContent; the service gets validated args and the caller', async () => {
  const seen = [];
  const client = await connect({ call: async (name, args, caller) => { seen.push({ name, args, caller }); return { result: RESULT, quota: { limit: 50, remaining: 30, resetAt: 0 } }; } });
  const res = await client.callTool({ name: 'compare_repos', arguments: { repos: ['a/b', 'c/d'] } });
  assert.ok(!res.isError);
  assert.deepEqual(res.structuredContent, RESULT);
  assert.match(res.content[0].text, /Comparison of 0 repositories/);
  assert.doesNotMatch(res.content[0].text, /free calls left/);
  assert.deepEqual(seen, [{ name: 'compare_repos', args: { repos: ['a/b', 'c/d'] }, caller: anon }]);
  await client.close();
});

test('under 10 calls left: the text says so', async () => {
  const resetAt = Date.now() + 3 * 3600_000 - 60_000;
  const client = await connect({ call: async () => ({ result: RESULT, quota: { limit: 50, remaining: 4, resetAt } }) });
  const res = await client.callTool({ name: 'compare_repos', arguments: { repos: ['a/b', 'c/d'] } });
  assert.match(res.content[0].text, /Note: 4 free calls left today; the limit resets in 3 h\./);
  await client.close();
});

test('HostedError becomes a tool error with the same message', async () => {
  const client = await connect({ call: async () => { throw new HostedError(429, 'Daily free limit reached (50).'); } });
  const res = await client.callTool({ name: 'compare_repos', arguments: { repos: ['a/b', 'c/d'] } });
  assert.equal(res.isError, true);
  assert.equal(res.content[0].text, 'Daily free limit reached (50).');
  await client.close();
});

test('GET and DELETE are 405 (no SSE stream, no sessions)', async () => {
  for (const method of ['GET', 'DELETE']) {
    const res = await handleMcp(new Request('https://w.test/mcp', { method }), { call: async () => ({}) }, anon);
    assert.equal(res.status, 405);
    assert.equal(res.headers.get('Allow'), 'POST');
  }
});
