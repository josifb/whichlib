#!/usr/bin/env node
// End-to-end check: start the server over stdio like a real client would,
// list the tools, and call each one against the live APIs. Then connect again
// as an MCP 2026-07-28 client ("auto" negotiation, and pinned to 2026-07-28):
// both must land on protocol version 2026-07-28 and answer compare_repos.
// Exits 1 on any failure, so it can gate a release or a deploy.
// Usage: npm run mcp:smoke [-- --url http://localhost:8787/mcp]

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const serverPath = join(dirname(fileURLToPath(import.meta.url)), 'server.mjs');
// --url <address>: run the same calls against a remote MCP server (Streamable HTTP), e.g. wrangler dev.
const urlArg = process.argv.indexOf('--url');
const remote = urlArg > -1 ? process.argv[urlArg + 1] : null;
if (urlArg > -1 && !remote) {
  console.error('Usage: npm run mcp:smoke [-- --url <mcp-address>]');
  process.exit(1);
}
// With GITHUB_TOKEN set, send it as the caller's own token (skips the free-tier limit); never printed.
const ownToken = remote ? process.env.GITHUB_TOKEN : null;
if (ownToken) console.log('(sending X-GitHub-Token)');

const transport = () => remote
  ? new StreamableHTTPClientTransport(new URL(remote), ownToken ? { requestInit: { headers: { 'X-GitHub-Token': ownToken } } } : undefined)
  : new StdioClientTransport({ command: process.execPath, args: [serverPath], env: process.env, stderr: 'inherit' });

let failures = 0;
function fail(message) {
  failures++;
  console.log(`FAIL: ${message}\n`);
}

async function connect(mode) {
  const client = new Client({ name: 'whichlib-smoke', version: '0.0.0' }, mode ? { versionNegotiation: { mode } } : {});
  const started = Date.now();
  await client.connect(transport());
  console.log(`--- connected (${mode ? JSON.stringify(mode) : 'default'}): protocol version ${client.getNegotiatedProtocolVersion()}, ${Date.now() - started} ms`);
  return client;
}

async function call(client, name, args) {
  const started = Date.now();
  const res = await client.callTool({ name, arguments: args });
  console.log(`=== ${name} ${JSON.stringify(args)} (${Date.now() - started} ms)${res.isError ? ' ERROR' : ''}`);
  console.log(res.content[0].text);
  if (res.structuredContent) console.log(`structuredContent: ${res.structuredContent.repos?.length ?? 0} repos`);
  console.log();
  return res;
}

// 1. The 2025 initialize handshake (what most clients still send): every tool, live.
try {
  const client = await connect(null);
  const { tools } = await client.listTools();
  console.log(`tools: ${tools.map((t) => t.name).join(', ')}
`);
  if (tools.length !== 3) fail(`expected 3 tools, got ${tools.length}`);
  if ((await call(client, 'trending_repos', { period: 'week', limit: 3 })).isError) fail('trending_repos');
  if ((await call(client, 'compare_repos', { repos: ['colinhacks/zod', 'encode/httpx', 'expressjs/express'] })).isError) fail('compare_repos');
  if ((await call(client, 'recommend_repos', { need: 'pdf parser', language: 'Python', limit: 3 })).isError) fail('recommend_repos');
  await call(client, 'compare_repos', { repos: ['not a name', 'colinhacks/zod'] }); // partial result or error: both are answers
  await client.close();
} catch (err) {
  fail(`2025 handshake: ${err.code ?? ''} ${err.message}`);
}

// 2. MCP 2026-07-28: "auto" must find it, a pin must get it. compare_repos makes no GitHub searches.
for (const mode of ['auto', { pin: '2026-07-28' }]) {
  try {
    const client = await connect(mode);
    const version = client.getNegotiatedProtocolVersion();
    if (version !== '2026-07-28') fail(`${JSON.stringify(mode)} connected on protocol version ${version}`);
    const listed = await client.listTools();
    if (listed.tools.length !== 3) fail(`${JSON.stringify(mode)}: expected 3 tools, got ${listed.tools.length}`);
    if ((await call(client, 'compare_repos', { repos: ['colinhacks/zod', 'fabian-hiller/valibot'] })).isError) fail(`${JSON.stringify(mode)}: compare_repos`);
    await client.close();
  } catch (err) {
    fail(`${JSON.stringify(mode)}: ${err.code ?? ''} ${err.message}`);
  }
}

console.log(failures ? `${failures} failure(s)` : 'smoke: all good');
process.exit(failures ? 1 : 0);
