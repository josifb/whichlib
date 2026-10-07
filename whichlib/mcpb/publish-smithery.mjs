// Publishes dist/whichlib-<version>.mcpb to Smithery with the full tool list.
// The Smithery CLI copies tools from the bundle manifest, but the MCPB schema
// does not allow inputSchema there and Smithery requires it, so this sends the
// same release request with the tools read from the staged server.
// Usage: npm run bundle, then SMITHERY_API_KEY=... npm run publish:smithery
import { readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const NAME = 'josifb/whichlib';
const apiKey = process.env.SMITHERY_API_KEY;
if (!apiKey) throw new Error('Set SMITHERY_API_KEY (smithery.ai → account → API keys).');

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const stage = join(pkgDir, 'dist', 'mcpb');
const manifest = JSON.parse(readFileSync(join(stage, 'manifest.json'), 'utf8'));
const bundlePath = join(pkgDir, 'dist', `whichlib-${manifest.version}.mcpb`);

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(stage, 'server', 'mcp', 'server.mjs')],
  env: { ...process.env, WHICHLIB_TELEMETRY: 'off', SMITHERY_API_KEY: '' },
});
const client = new Client({ name: 'whichlib-publish', version: manifest.version });
await client.connect(transport);
const { tools } = await client.listTools();
await client.close();

const payload = {
  type: 'stdio',
  runtime: 'node',
  serverCard: {
    serverInfo: { name: manifest.name, version: manifest.version },
    tools: tools.map(({ name, title, description, inputSchema, annotations }) =>
      ({ name, title, description, inputSchema, ...(annotations ? { annotations } : {}) })),
  },
  configSchema: {
    type: 'object',
    properties: {
      github_token: {
        type: 'string',
        title: manifest.user_config.github_token.title,
        description: manifest.user_config.github_token.description,
      },
    },
    required: [],
  },
};

const form = new FormData();
form.append('payload', JSON.stringify(payload));
form.append('bundle', new Blob([readFileSync(bundlePath)]), basename(bundlePath));
const res = await fetch(`https://api.smithery.ai/servers/${NAME}/releases`, {
  method: 'PUT',
  headers: { Authorization: `Bearer ${apiKey}` },
  body: form,
});
const text = await res.text();
if (!res.ok) throw new Error(`Smithery ${res.status}: ${text}`);
console.log(`Published ${NAME} ${manifest.version} with ${tools.length} tools: ${text}`);
