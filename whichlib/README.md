# whichlib

The dependency picker for coding agents. Ask which library to use and get a
scored, verified answer instead of a guess.

whichlib is an MCP server with three tools. Every repository it returns
carries a transparent 0–100 score (momentum, maintenance, adoption including
npm and PyPI downloads, license), a tier, a one-line verdict and the full
breakdown, so the agent can justify the pick and you can read why.

## Install

Claude Code:

```
claude mcp add whichlib -- npx -y whichlib
```

Cursor, Windsurf and other MCP clients:

```json
{ "mcpServers": { "whichlib": { "command": "npx", "args": ["-y", "whichlib"] } } }
```

Requires Node 22 or newer. No account, no API key.

## Tools

| Tool | Ask | You get |
|---|---|---|
| `recommend_repos` | `need` in plain words, optional `language`, `limit` 1–10 | The best repositories for the need, ranked by fit (score × relevance), with downloads and a verdict each |
| `compare_repos` | `repos`: 2–10 names as `owner/repo` | The repositories side by side, best first, same breakdown |
| `trending_repos` | `period` day / week / month, optional `language`, `limit` | Most-starred repositories created in the period, scored |

Example, in Claude Code: "which Python PDF parser should I use?" →
MinerU, pdfplumber, pypdf with scores, weekly downloads and verdicts like
"Rising fast, 26k downloads/wk, pushed 3 days ago, Apache-2.0".

## Score

| Part | Weight | Signal |
|---|---|---|
| Momentum | 40% | Stars gained over 7 days (from daily snapshots when available), else stars per day since creation. Log scale. |
| Maintenance | 25% | Days since last push, full marks to 30 days, zero at a year. Widely used repos (10k+ stars or 100k+ weekly downloads) never drop below half. |
| Adoption | 25% | Stars, forks and npm / PyPI weekly downloads, log scale. |
| License | 10% | Permissive 1.0, weak copyleft 0.75, strong copyleft 0.5, none 0. |

Tiers: Strong ≥ 75, Solid ≥ 50, Watch ≥ 25, Avoid. Archived repos are capped
at 20. On a 20-need eval the top recommendation is an accepted answer 75% of
the time and the top five contain one 100% of the time; the eval and its
reports live in the repository.

## Environment variables, all optional

- `GITHUB_TOKEN`: raises GitHub's search limit from 10 to 30 per minute. A
  fine-grained token with no permissions is enough. Recommend makes three
  searches per call.
- `FRESH_REPOS_DATA_DIR`: a folder of daily snapshots for real 7-day momentum
  (see the repository's data branch).
- `WHICHLIB_TELEMETRY=off` or `DO_NOT_TRACK=1`: disables anonymous call
  counting. What is counted: tool name, a random install id, version,
  platform, Node major version. Never queries, repository names or results.
  The aggregate numbers are public at
  https://whichlib-telemetry.todorovskijosif.workers.dev/stats.

## Source, dashboard, data

Repository: https://github.com/josifb/whichlib (MIT). It also holds the
Fresh Repos dashboard (most-starred new repositories, day / week / month,
sortable, one HTML file), the nightly snapshot and enrichment jobs, the
recommendation eval, and 80+ unit tests.

Development, from the `whichlib/` folder of the repository:

```
npm test           # unit tests, no network
npm run mcp:smoke  # start the server over stdio and call every tool live
npm run eval       # 20-need recommendation eval (set GITHUB_TOKEN)
npm run snapshot   # today's top repos per period and language -> data/snapshots/
npm run enrich     # add npm / PyPI packages and weekly downloads to the latest snapshot
npm run score      # top repos from the latest snapshot with score and verdict
npm run pull-data  # copy snapshots from the data branch
```

Layout:

```
mcp/server.mjs         MCP entry (stdio)        mcp/tools.mjs       tool logic
mcp/expand.mjs         query expansion          mcp/telemetry.mjs   anonymous call counting
mcp/github-api.mjs     GitHub client + cache    mcp/data.mjs        snapshot history provider
mcp/eval/              needs, metrics, runner, inspect, results/
lib/score.js           the score, shared by browser and Node
snapshot/src/          query, normalize, github, registry, enrich, history, run, score-report, pull-data
dashboard/index.html   Fresh Repos
```
