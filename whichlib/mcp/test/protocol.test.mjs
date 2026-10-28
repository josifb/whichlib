import { test } from 'node:test';
import assert from 'node:assert/strict';
import { callProtocolVersion, normalizeProtocolVersion, serverInfo, SERVER_INSTRUCTIONS, TOOLS_LIST_CACHE } from '../protocol.mjs';

const server = (negotiated) => ({ server: { getNegotiatedProtocolVersion: () => negotiated } });

test('callProtocolVersion: the 2026-07-28 request envelope wins', () => {
  const ctx = { mcpReq: { envelope: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' } } };
  assert.equal(callProtocolVersion(server('2025-11-25'), ctx), '2026-07-28');
});

test('callProtocolVersion: else the version negotiated by initialize (stdio, 2025 protocol versions)', () => {
  assert.equal(callProtocolVersion(server('2025-06-18'), { mcpReq: {} }), '2025-06-18');
});

test('callProtocolVersion: else the MCP-Protocol-Version header (hosted, 2025 protocol versions, stateless)', () => {
  const ctx = { mcpReq: {}, http: { req: new Request('https://w.test/mcp', { headers: { 'mcp-protocol-version': '2025-11-25' } }) } };
  assert.equal(callProtocolVersion(server(undefined), ctx), '2025-11-25');
});

test('callProtocolVersion: null when nothing says', () => {
  assert.equal(callProtocolVersion(server(undefined), {}), null);
  assert.equal(callProtocolVersion({}, undefined), null);
});

test('TOOLS_LIST_CACHE: tools/list cacheable for an hour by anyone', () => {
  assert.deepEqual(TOOLS_LIST_CACHE, { 'tools/list': { ttlMs: 3_600_000, cacheScope: 'public' } });
});

test('serverInfo: name, version, title, website and the logo as icons', () => {
  const info = serverInfo('9.9.9');
  assert.equal(info.name, 'whichlib');
  assert.equal(info.version, '9.9.9');
  assert.equal(info.title, 'whichlib');
  assert.equal(info.websiteUrl, 'https://whichlib.com');
  assert.deepEqual(info.icons, [
    { src: 'https://whichlib.com/logo.png', mimeType: 'image/png', sizes: ['400x400'] },
    { src: 'https://whichlib.com/logo.svg', mimeType: 'image/svg+xml', sizes: ['any'] },
  ]);
});

test('normalizeProtocolVersion: a dated MCP revision, else null', () => {
  assert.equal(normalizeProtocolVersion('2026-07-28'), '2026-07-28');
  assert.equal(normalizeProtocolVersion('2025-06-18'), '2025-06-18');
  for (const bad of [null, undefined, '', 'latest', '<script>', '2026-07-28x', '26-07-28', 20260728]) assert.equal(normalizeProtocolVersion(bad), null, String(bad));
});

test('SERVER_INSTRUCTIONS: says when to call each picking tool, within the 4,096-char limit clients load at start', () => {
  assert.ok(SERVER_INSTRUCTIONS.length > 100 && SERVER_INSTRUCTIONS.length <= 4096);
  for (const name of ['recommend_repos', 'compare_repos', 'trending_repos']) assert.ok(SERVER_INSTRUCTIONS.includes(name), name);
  assert.match(SERVER_INSTRUCTIONS, /before adding a dependency/i);
});
