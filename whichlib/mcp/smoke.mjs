#!/usr/bin/env node
// End-to-end check: start the server over stdio like a real client would,
// list the tools, and call each one against the live APIs.
// Usage: npm run mcp:smoke

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const serverPath = join(dirname(fileURLToPath(import.meta.url)), 'server.mjs');
const transport = new StdioClientTransport({ command: process.execPath, args: [serverPath], env: process.env, stderr: 'inherit' });
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
