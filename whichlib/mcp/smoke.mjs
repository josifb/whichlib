#!/usr/bin/env node
// End-to-end check: start the server over stdio like a real client would,
// list the tools, and call each one against the live APIs.
// Usage: npm run mcp:smoke [-- --url http://localhost:8787/mcp]

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

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
const transport = remote
  ? new StreamableHTTPClientTransport(new URL(remote), ownToken ? { requestInit: { headers: { 'X-GitHub-Token': ownToken } } } : undefined)
  : new StdioClientTransport({ command: process.execPath, args: [serverPath], env: process.env, stderr: 'inherit' });
const client = new Client({ name: 'whichlib-smoke', version: '0.0.0' });
await client.connect(transport);

const { tools } = await client.listTools();
console.log(`tools: ${tools.map((t) => t.name).join(', ')}\n`);

async function call(name, args) {
  const started = Date.now();
  const res = await client.callTool({ name, arguments: args });
  console.log(`=== ${name} ${JSON.stringify(args)} (${Date.now() - started} ms)${res.isError ? ' ERROR' : ''}`);
  console.log(res.content[0].text);
  if (res.structuredContent) console.log(`structuredContent: ${res.structuredContent.repos?.length ?? 0} repos`);
  console.log();
}

await call('trending_repos', { period: 'week', limit: 3 });
await call('compare_repos', { repos: ['colinhacks/zod', 'encode/httpx', 'expressjs/express'] });
await call('recommend_repos', { need: 'pdf parser', language: 'Python', limit: 3 });
await call('compare_repos', { repos: ['not a name', 'colinhacks/zod'] });

await client.close();
