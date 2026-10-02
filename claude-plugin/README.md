# whichlib plugin for Claude Code

whichlib is a dependency picker for coding agents. Before Claude adds a
library, it can ask whichlib which one to use and get GitHub repositories
ranked by a transparent 0-100 score (momentum 40%, maintenance 25%, adoption
including npm and PyPI weekly downloads 25%, license 10%), each with a tier
and a one-line verdict such as "Gaining steadily, 145M downloads/wk, pushed 3
days ago, MIT". The full breakdown is returned, so every pick can be
explained.

The plugin contains:

- **MCP server `whichlib`** with three tools: `recommend_repos` (best
  repositories for a need in plain words), `compare_repos` (two to ten
  repositories side by side) and `trending_repos` (most-starred repositories
  created in the last day, week or month).
- **Skill `choosing-dependencies`**, which tells Claude to check a new
  library with whichlib before adding it and to state the score and verdict
  it relied on.

## Install

```
/plugin marketplace add josifb/whichlib
/plugin install whichlib@whichlib
```

Or use the hosted server, with nothing to install:

```
claude mcp add --transport http whichlib https://whichlib.com/mcp
```

Limits and the web API: https://whichlib.com/docs/

The plugin requires Node.js 22 or newer. On first use the server is downloaded from npm
as the exact version `whichlib@0.1.4`.

## Settings

**GitHub token (optional).** Without a token GitHub allows about three
recommendations per minute; with one, about ten. A fine-grained token with no
permissions is enough. It is stored in your system's secure credential store
and only sent to GitHub.

## What it runs, sends and stores

- Runs `npx -y whichlib@0.1.4`, a local Node.js process speaking MCP over
  stdio. Source: https://github.com/josifb/whichlib (MIT).
- Reads public data over HTTPS from `api.github.com` (repository search and
  details), `registry.npmjs.org` and `api.npmjs.org` (package metadata and
  weekly downloads), and `pypi.org` and `pypistats.org` (package metadata and
  downloads). Your search text is sent to GitHub as a search query.
- At most every 12 hours, downloads public daily star counts (for momentum)
  from `raw.githubusercontent.com/josifb/whichlib/data/stars/`. Nothing is
  sent. Turn it off with `WHICHLIB_HISTORY=off`. `trending_repos` with
  `period: "rising"` also downloads the public daily `rising.json` from the
  same place (at most once an hour).
- Sends anonymous call counts to
  `https://whichlib-telemetry.todorovskijosif.workers.dev`: the tool name, a
  random install id, the whichlib version, platform and Node major version.
  Never queries, repository names, results, user names or paths. The totals
  are public at that address under `/stats`. Turn it off by setting
  `WHICHLIB_TELEMETRY=off` or `DO_NOT_TRACK=1` in your environment.
- Stores the random install id in `~/.whichlib/install-id` and the last 10
  days of star counts in `~/.whichlib/stars/`. Nothing else is written.

## License

MIT. See the [repository](https://github.com/josifb/whichlib) for the
scoring method, the evaluation and the source code.
