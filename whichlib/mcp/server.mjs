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
import { z } from 'zod';
import { createGitHubClient } from './github-api.mjs';
import { loadHistoryProvider, createRisingLoader } from './data.mjs';
import { createTools, formatResult } from './tools.mjs';
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

// Every tool only reads public data from GitHub, npm and PyPI.
const annotations = { readOnlyHint: true, openWorldHint: true };
const SCORE = 'Each result has a 0-100 score (momentum 40% (stars gained per week; without history, lifetime stars per week scaled by the npm/PyPI download trend), maintenance 25%, adoption incl. npm/PyPI weekly downloads 25%, license 10%), a tier (Strong >=75, Solid >=50, Watch >=25, Avoid <25), a one-line verdict and the full breakdown.';
const RATE = 'Without a GitHub token GitHub allows about 10 searches per minute; when the limit is hit the tool returns an error saying when it resets.';

server.registerTool('recommend_repos', {
  title: 'Recommend repositories',
  description: `Find the best open-source library for a need before adding a dependency. Give the need in plain words and get up to \`limit\` GitHub repositories ranked by fit = score x relevance to the need. ${SCORE} Use this when you do not yet have candidates; use compare_repos when you already have names. Makes 3 GitHub searches plus npm/PyPI lookups for the shortlist. ${RATE}`,
  inputSchema: {
    need: z.string().min(2).max(200).describe('The need in plain words, e.g. "python pdf parser", "react state management". Name the task, not a library.'),
    language: z.string().min(1).max(40).optional().describe('GitHub language name, e.g. "TypeScript", "Python", "Rust", "C++". JavaScript also matches TypeScript repositories and the reverse; Python also matches Jupyter Notebook. Omit to search all languages.'),
    limit: z.number().int().min(1).max(10).default(5).describe('How many repositories to return, 1-10.'),
  },
  annotations,
}, run('recommend_repos', tools.recommend));

server.registerTool('compare_repos', {
  title: 'Compare repositories',
  description: `Compare 2-10 known GitHub repositories side by side, best score first: score and tier, stars, forks, open issues, last push, license, npm/PyPI weekly downloads (only when the registry links back to the repository) and a verdict. ${SCORE} Use this to choose between candidates you already have (for example zod vs valibot) or to check a dependency the project already uses; use recommend_repos to find candidates. One GitHub API call per repository plus npm/PyPI lookups. A repository that does not exist is listed under notFound and the rest are still compared; the call fails only if none can be fetched.`,
  inputSchema: {
    repos: z.array(z.string().min(3).max(140)).min(2).max(10).describe('Repository names as owner/repo, e.g. ["colinhacks/zod", "fabian-hiller/valibot"]. Not URLs or npm/PyPI package names.'),
  },
  annotations,
}, run('compare_repos', tools.compare));

server.registerTool('trending_repos', {
  title: 'Trending repositories',
  description: `Discover projects: the most-starred GitHub repositories created in the last day, week or month, or with period "rising" repositories of any age that gained the most stars this week (like GitHub Trending; risingRank keeps that order). Optionally one language; each scored and returned sorted by score (starsRank keeps the stars order). ${SCORE} Not the right tool for picking a dependency, since new repositories have little maintenance history; use recommend_repos for that. One GitHub search (rising: one download of the daily list from raw.githubusercontent.com instead), plus one npm/PyPI lookup per repository when withDownloads is true. ${RATE}`,
  inputSchema: {
    period: z.enum(['day', 'week', 'month', 'rising']).default('week').describe('"day", "week" or "month": repos created in the last 24 hours, 7 days or 30 days. "rising": repos of any age by stars gained this week (the top 1,000 repos per language plus new ones are tracked).'),
    language: z.string().min(1).max(40).optional().describe('GitHub language name, e.g. "TypeScript", "Python", "Rust". Matches that language only. Omit for all languages.'),
    limit: z.number().int().min(1).max(100).default(20).describe('How many repositories to return, 1-100.'),
    withDownloads: z.boolean().default(false).describe('Also look up npm/PyPI weekly downloads for each repository. Slower: one registry lookup per repository.'),
  },
  annotations,
}, run('trending_repos', tools.trending));

await server.connect(new StdioServerTransport());
console.error(`whichlib MCP ${pkg.version} ready | token: ${github.hasToken ? 'yes' : 'no'} | history: ${history.days ? `${history.days} day(s), latest ${history.latestDate}` : 'none'} | anonymous call counting: ${telemetry.enabled ? 'on (set WHICHLIB_TELEMETRY=off to disable)' : 'off'}`);
