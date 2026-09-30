#!/usr/bin/env node
// whichlib MCP server (stdio). Three tools: recommend_repos, compare_repos,
// trending_repos. stdout is the protocol channel: log to stderr only.
//
//   GITHUB_TOKEN           optional, raises GitHub rate limits
//   FRESH_REPOS_DATA_DIR   optional, folder of daily snapshots or stars files for real momentum
//   WHICHLIB_HISTORY=off   do not download star history to ~/.whichlib/stars
//   WHICHLIB_TELEMETRY=off or DO_NOT_TRACK=1  disable anonymous call counting

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createGitHubClient } from './github-api.mjs';
import { loadHistoryProvider, createRisingLoader } from './data.mjs';
import { createTools, formatResult } from './tools.mjs';
import { toolDefinitions } from './definitions.mjs';
import { createTelemetry } from './telemetry.mjs';
import { resolvePackages } from '../snapshot/src/registry.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(await readFile(join(here, '..', 'package.json'), 'utf8'));

const github = createGitHubClient();
const { provider: history } = await loadHistoryProvider();
const tools = createTools({ github, resolvePackages, history, loadRising: createRisingLoader() });
const telemetry = createTelemetry({ version: pkg.version });

const server = new McpServer({ name: 'whichlib', version: pkg.version });

const run = (name, fn) => async (args) => {
  telemetry.record(name); // fire-and-forget, never awaited
  try {
    const result = await fn(args);
    return { content: [{ type: 'text', text: formatResult(result) }], structuredContent: result };
  } catch (err) {
    return { isError: true, content: [{ type: 'text', text: err.message }] };
  }
};

const handlers = { recommend_repos: tools.recommend, compare_repos: tools.compare, trending_repos: tools.trending };
for (const { name, config } of toolDefinitions()) server.registerTool(name, config, run(name, handlers[name]));

await server.connect(new StdioServerTransport());
console.error(`whichlib MCP ${pkg.version} ready | token: ${github.hasToken ? 'yes' : 'no'} | history: ${history.days ? `${history.days} day(s), latest ${history.latestDate}` : 'none'} | anonymous call counting: ${telemetry.enabled ? 'on (set WHICHLIB_TELEMETRY=off to disable)' : 'off'}`);
