#!/usr/bin/env node
// whichlib MCP server (stdio). Three tools: recommend_repos, compare_repos,
// trending_repos. stdout is the protocol channel: log to stderr only.
//
//   GITHUB_TOKEN           optional, raises GitHub rate limits
//   FRESH_REPOS_DATA_DIR   optional, folder of daily snapshots for real momentum
//   WHICHLIB_TELEMETRY=off or DO_NOT_TRACK=1  disable anonymous call counting

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createGitHubClient } from './github-api.mjs';
import { loadHistoryProvider } from './data.mjs';
import { createTools, formatResult } from './tools.mjs';
import { createTelemetry } from './telemetry.mjs';
import { resolvePackages } from '../snapshot/src/registry.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(await readFile(join(here, '..', 'package.json'), 'utf8'));

const github = createGitHubClient();
const history = await loadHistoryProvider();
const tools = createTools({ github, resolvePackages, history });
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

const languageArg = z.string().min(1).max(40).optional().describe('GitHub language name, e.g. "TypeScript", "Python", "C++".');

server.registerTool('recommend_repos', {
  title: 'Recommend repositories',
  description: 'Given a need in plain words (e.g. "python pdf parser", "react state management"), return the best open-source repositories ranked by a transparent 0–100 score (momentum 40%, maintenance 25%, adoption incl. npm/PyPI downloads 25%, license 10%) with a one-line verdict each. Use before adding a dependency.',
  inputSchema: {
    need: z.string().min(2).max(200).describe('What you need, in a few words.'),
    language: languageArg,
    limit: z.number().int().min(1).max(10).default(5).describe('How many recommendations to return.'),
  },
}, run('recommend_repos', tools.recommend));

server.registerTool('compare_repos', {
  title: 'Compare repositories',
  description: 'Compare two to ten GitHub repositories (owner/repo) side by side: score, tier, stars, forks, open issues, last push, license, npm/PyPI weekly downloads, and a verdict. Sorted best first.',
  inputSchema: {
    repos: z.array(z.string().min(3).max(140)).min(2).max(10).describe('Repository names in the form owner/repo.'),
  },
}, run('compare_repos', tools.compare));

server.registerTool('trending_repos', {
  title: 'Trending repositories',
  description: 'Most-starred repositories created in the last day, week or month, optionally filtered by language, each scored. Set withDownloads to also look up npm/PyPI weekly downloads (slower).',
  inputSchema: {
    period: z.enum(['day', 'week', 'month']).default('week'),
    language: languageArg,
    limit: z.number().int().min(1).max(100).default(20),
    withDownloads: z.boolean().default(false),
  },
}, run('trending_repos', tools.trending));

await server.connect(new StdioServerTransport());
console.error(`whichlib MCP ${pkg.version} ready | token: ${github.hasToken ? 'yes' : 'no'} | history: ${history.days ? `${history.days} day(s), latest ${history.latestDate}` : 'none'} | anonymous call counting: ${telemetry.enabled ? 'on (set WHICHLIB_TELEMETRY=off to disable)' : 'off'}`);
