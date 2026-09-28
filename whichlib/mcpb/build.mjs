// Builds dist/whichlib-<version>.mcpb: the MCP server plus production
// dependencies in the MCP Bundle format (Claude Desktop, Smithery).
// Usage: npm run bundle
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
const manifest = JSON.parse(readFileSync(join(pkgDir, 'mcpb', 'manifest.json'), 'utf8'));
if (manifest.version !== pkg.version) {
  throw new Error(`mcpb/manifest.json version ${manifest.version} != package.json ${pkg.version}`);
}

const stage = join(pkgDir, 'dist', 'mcpb');
const server = join(stage, 'server');
rmSync(stage, { recursive: true, force: true });
mkdirSync(server, { recursive: true });
for (const p of ['mcp', 'lib', 'snapshot/src', 'package.json', 'package-lock.json', 'LICENSE']) {
  cpSync(join(pkgDir, p), join(server, p), {
    recursive: true,
    filter: (src) => !/[\\/](test|eval)([\\/]|$)/.test(src),
  });
}
execSync('npm ci --omit=dev --ignore-scripts --no-audit --no-fund', { cwd: server, stdio: 'inherit' });

// Smithery rejects manifest tools without an inputSchema, and the MCPB schema
// does not allow one, so ship no static list: tools come from the server.
// Check the staged server really starts and serves them.
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(server, 'mcp', 'server.mjs')],
  env: { ...process.env, WHICHLIB_TELEMETRY: 'off' },
});
const client = new Client({ name: 'whichlib-bundle', version: pkg.version });
await client.connect(transport);
const { tools } = await client.listTools();
await client.close();
if (tools.length === 0) throw new Error('staged server lists no tools');
console.log(`staged server tools: ${tools.map((t) => t.name).join(', ')}`);
delete manifest.tools;
manifest.tools_generated = true;
writeFileSync(join(stage, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

const out = join(pkgDir, 'dist', `whichlib-${pkg.version}.mcpb`);
execSync(`npx -y @anthropic-ai/mcpb@2 pack "${stage}" "${out}"`, { stdio: 'inherit' });
console.log(`\nBuilt ${out}`);
