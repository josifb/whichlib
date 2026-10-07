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
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createGitHubClient } from './github-api.mjs';
import { loadHistoryProvider, createRisingLoader } from './data.mjs';
import { createTools, formatResult } from './tools.mjs';
import { toolDefinitions } from './definitions.mjs';
import { callProtocolVersion, TOOLS_LIST_CACHE } from './protocol.mjs';
import { createTelemetry } from './telemetry.mjs';
import { resolvePackages } from '../snapshot/src/registry.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(await readFile(join(here, '..', 'package.json'), 'utf8'));

const github = createGitHubClient();
const { provider: history } = await loadHistoryProvider();
const tools = createTools({ github, resolvePackages, history, loadRising: createRisingLoader() });
const telemetry = createTelemetry({ version: pkg.version });

const run = (server, name, fn) => async (args, ctx) => {
  telemetry.record(name, { protocolVersion: callProtocolVersion(server, ctx) }); // fire-and-forget, never awaited
  try {
    const result = await fn(args);
    return { content: [{ type: 'text', text: formatResult(result) }], structuredContent: result };
  } catch (err) {
    return { isError: true, content: [{ type: 'text', text: err.message }] };
  }
};

const handlers = { recommend_repos: tools.recommend, compare_repos: tools.compare, trending_repos: tools.trending };

// One McpServer per connection; serveStdio answers both MCP 2026-07-28 and 2025-era clients.
function buildServer() {
  const server = new McpServer({ name: 'whichlib', version: pkg.version }, { cacheHints: TOOLS_LIST_CACHE });
  for (const { name, config } of toolDefinitions()) server.registerTool(name, config, run(server, name, handlers[name]));
  return server;
}

serveStdio(() => buildServer());
console.error(`whichlib MCP ${pkg.version} ready | token: ${github.hasToken ? 'yes' : 'no'} | history: ${history.days ? `${history.days} day(s), latest ${history.latestDate}` : 'none'} | anonymous call counting: ${telemetry.enabled ? 'on (set WHICHLIB_TELEMETRY=off to disable)' : 'off'}`);
