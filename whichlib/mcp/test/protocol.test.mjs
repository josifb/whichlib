import { test } from 'node:test';
import assert from 'node:assert/strict';
import { callProtocolVersion, TOOLS_LIST_CACHE } from '../protocol.mjs';

const server = (negotiated) => ({ server: { getNegotiatedProtocolVersion: () => negotiated } });

test('callProtocolVersion: the 2026-07-28 request envelope wins', () => {
  const ctx = { mcpReq: { envelope: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' } } };
  assert.equal(callProtocolVersion(server('2025-11-25'), ctx), '2026-07-28');
});

test('callProtocolVersion: else the version negotiated by initialize (stdio, 2025 era)', () => {
  assert.equal(callProtocolVersion(server('2025-06-18'), { mcpReq: {} }), '2025-06-18');
});

test('callProtocolVersion: else the MCP-Protocol-Version header (hosted, 2025 era, stateless)', () => {
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
