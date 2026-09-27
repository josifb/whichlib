# Fresh Repos

Find the most-starred GitHub repositories created in the last day, week and
month, and sort them your way. Open it every morning.

This repository is also the starting point for a larger product: a dependency
picker for AI coding agents. The dashboard is its free front door and its data
collector. The plan is in [`docs/ideas/dependency-picker-for-agents.md`](docs/ideas/dependency-picker-for-agents.md).

## Quick start

1. Clone or download this repository.
2. Double-click `github-trending/dashboard/index.html`.

That is all. The page is a single HTML file that calls the GitHub Search API
straight from your browser. No build step, no server, no account.

Optional: paste a GitHub token under **Settings** on the page to raise the
API limit from 10 to 30 requests per minute. A fine-grained token with no
permissions is enough. It stays in your browser's local storage.

## What you get

- Three tabs: **Today**, **This week**, **This month**. Each lists the 100
  most-starred repos created in that window.
- Sort by any column: stars, stars per day, forks, open issues, created date,
  last push, language, license or name. Click again to reverse.
- Filter by language (17 languages) or by free text over name, description
  and topics.
- The rank column always shows the stars rank, so after sorting by forks you
  still see where a repo stands.
- Results are cached in the browser for 60 minutes per tab and language.
- Light and dark themes follow your system setting.

## How the numbers are defined

- **Trending** here means "created in the period, ranked by stars". That is
  what the GitHub Search API supports. GitHub's own trending page ranks by
  stars gained in the period, which has no public API. The nightly snapshots
  in this repo will make that possible later.
- **Downloads** do not exist for repositories on GitHub, only for release
  files. Forks are shown as the nearest public signal.
- **Stars/day** is stars divided by the repo's age, floored at one hour.

## Score

Every repo gets a score from 0 to 100, a tier and a one-line verdict. The
breakdown is always returned so a person or an agent can see why. The same
file, `github-trending/lib/score.js`, runs in the dashboard and in Node, so
the two can never disagree.

| Part | Weight | Signal |
|---|---|---|
| Momentum | 40% | Stars gained over the last 7 days from our snapshots. Without history, stars per day since creation times 7, with age floored at one day. Log scale: 50 a week is already good, 5,000 is the max. |
| Maintenance | 25% | Days since last push: full marks up to 7 days, zero at 90, linear between. Minus 0.2 when open issues exceed a tenth of the stars. |
| Adoption | 25% | With weekly downloads known: 50% stars (max 100k), 20% forks (max 20k), 30% downloads (max 1M). Otherwise 70% stars, 30% forks. All log scale. |
| License | 10% | Permissive 1.0, weak copyleft 0.75, strong copyleft 0.5, unrecognised 0.5, none 0. |

Tiers: **Strong** 75 and above, **Promising** 50, **Watch** 25, **Avoid**
below 25. Archived repos are capped at 20 and get the verdict "Archived,
avoid." A missing license is always named in the verdict.

Verdicts read like "Rising fast, 10.6k downloads/wk, pushed 2 days ago, MIT"
or "Slow growth, no push in 60 days, GPL-3.0".

### Downloads

GitHub has no download count for repositories, but package registries do.
After each snapshot, the enrich step maps JavaScript and TypeScript repos to
npm and Python repos to PyPI, then fetches last week's downloads:

- A package counts as the repo's only when the registry's own metadata links
  back to `github.com/<owner>/<repo>`. A matching name alone is never enough,
  so a new repo called `widget` is not credited with the downloads of an
  unrelated `widget` package.
- Candidates tried: `<repo>` and `@<owner>/<repo>` on npm, `<repo>` on PyPI.
- Mappings are cached in `registry-map.json` on the `data` branch. Negatives
  are re-checked after 7 days, positives kept, downloads refreshed daily.
- On the first run, 63 of 858 eligible repos mapped to a package. Most repos
  under a month old are not published yet, which is expected.

Other languages (Rust, Go, Java...) are skipped for now. Cargo, Go and Maven
can follow the same pattern.

Caveat: opened from disk, the dashboard has no snapshot history, so momentum
uses the fallback. Scores on the Today tab are therefore provisional; the
report and the MCP server use real stars-gained figures once there are two or
more days of snapshots.

```
cd github-trending
npm run score      # top 25 repos from the latest snapshot with score and verdict
```

## MCP server

The same score, served to coding agents. Three tools over stdio:

| Tool | Input | What it returns |
|---|---|---|
| `recommend_repos` | `need` in plain words, optional `language`, `limit` (1–10, default 5) | The best repositories for the need, ranked by fit (score × relevance), with npm/PyPI downloads and a verdict each. Candidates come from GitHub's relevance order, its stars order and a topic query; see "How recommend finds and ranks candidates" below. |
| `compare_repos` | `repos`: 2–10 names as `owner/repo` | The repositories side by side, best first, same breakdown. |
| `trending_repos` | `period` day/week/month, optional `language`, `limit` (default 20), `withDownloads` | Most-starred repos created in the period, scored. |

Every result carries readable text and `structuredContent` (JSON) with the
score, tier, verdict, the four subscores, flags, packages and downloads.

Install into Claude Code (replace the path with your clone):

```
claude mcp add fresh-repos -- node E:\private\github-trending\mcp\server.mjs
```

Cursor, Windsurf and others take the same command in their MCP config:

```json
{ "mcpServers": { "fresh-repos": { "command": "node", "args": ["E:\\private\\github-trending\\mcp\\server.mjs"] } } }
```

Environment variables, both optional:

- `GITHUB_TOKEN` raises GitHub's limits (search 10 to 30 per minute). A
  fine-grained token with no permissions is enough. Recommend makes three
  searches per call, so without a token it allows about three recommendations
  per minute.
- `FRESH_REPOS_DATA_DIR` points at a folder of daily snapshots. The default is
  `github-trending/data/snapshots`, filled by `npm run pull-data`. With two or
  more days present, momentum uses real 7-day stars gained.

Try it without a client:

```
cd github-trending
npm run mcp:smoke   # starts the server over stdio, lists tools, calls each one
```

Known bias: maintenance drops to zero at 90 days without a push, so a stable,
finished library scores lower than an active one. Release cadence will soften
this later.

### Recommendation eval

`mcp/eval/needs.json` holds 20 needs ("pdf parser" in Python, "state
management" in TypeScript, ...) each with a set of accepted answers a senior
engineer would consider reasonable. `npm run eval` runs them through
`recommend_repos` live and reports how often an accepted repo appears at
rank 1, 3 and 5, for our ranking and for baselines built from the same
candidate pool. Reports land in `mcp/eval/results/`.

Result on 2026-09-27, after query expansion (second report in `results/`):

| Ranking | hit@1 | hit@3 | hit@5 | MRR |
|---|---|---|---|---|
| ours (fit, see below) | 75% | 95% | 100% | 0.85 |
| GitHub relevance order | 65% | 80% | 95% | 0.76 |
| stars order | 45% | 65% | 75% | 0.56 |
| score only, no relevance | 30% | 65% | 70% | 0.46 |

The first report, before expansion, had the same hit rates for our ranking
(75 / 95 / 100, MRR 0.86) on a smaller pool. Expansion raised recall from 53
to 74 accepted repos across the 20 pools, never fewer on any need, and the
baselines fell on that noisier pool while ours held. The fit rules are what
keep the noise out.

### How recommend finds and ranks candidates

Retrieval, three GitHub searches per need:

1. Text search in GitHub's relevance order, with known synonyms OR-ed in
   (`async OR asynchronous runtime`), so vocabulary differences stop hiding
   libraries like tokio.
2. The same text search in stars order, for the big names whose description
   only mentions the subject.
3. One topic query sorted by stars (`topic:cli`, `topic:image-processing`),
   which surfaces what maintainers tagged themselves. The head word is used
   when it is specific (pdf, cli, orm) and the hyphenated phrase when it is
   broad (image-processing, state-management). GitHub rejects `OR` between
   topics, so it is one per request.

Language filters use families: JavaScript includes TypeScript and Python
includes Jupyter, because many libraries moved to TypeScript.

Ranking key is `fit = score × relevance`:

- relevance is 1.0 at GitHub relevance rank 1 falling to 0.5 at rank 25,
  0.75 when found only through the topic query, 0.4 when found only in the
  stars order;
- ×0.75 when the repo names the subject only in its topic tags and ×0.5 when
  nowhere in its name, description or topics (it matched README text only);
- ×0.8 when you asked for a framework, library, parser or client and the repo
  reads like an application rather than a building block.

Both `score` and `fit` are returned, with the relevance rank, the sources the
repo came from and the two signals, so an agent can see why.

`node mcp/eval/inspect.mjs "<need>" [language] [wanted/repo ...]` prints the
whole candidate pool for one need with these values.

## Nightly snapshot job

`github-trending/snapshot/` is a zero-dependency Node 22 script that stores the
top 100 repos for 3 periods times 9 languages into
`github-trending/data/snapshots/YYYY-MM-DD.json`. Consecutive snapshots are
what a momentum score needs.

```
cd github-trending
npm test          # 16 unit tests, no network
npm run snapshot  # about 3 minutes without a token, 1 minute with GITHUB_TOKEN
```

A GitHub Actions workflow ([`.github/workflows/snapshot.yml`](.github/workflows/snapshot.yml))
runs the job every day at 06:17 UTC and commits the result to the `data`
branch, so history accumulates without bloating `main`. Trigger it by hand
from the Actions tab or with `gh workflow run snapshot`. Bring the files down
locally with:

```
cd github-trending
npm run pull-data  # copies new snapshots from origin/data into data/snapshots/
npm run score      # now with real 7-day stars gained once there are 2+ days
```

A Windows Task Scheduler alternative is in
[`github-trending/README.md`](github-trending/README.md).

## Repository layout

```
github-trending/dashboard/   the app, one HTML file
github-trending/lib/         score.js, shared by browser and Node
github-trending/mcp/         MCP server: recommend_repos, compare_repos, trending_repos
github-trending/snapshot/    snapshot job, enrichment, history builder, score report, tests
docs/ideas/                  product one-pager
docs/superpowers/            implementation plans
```

## Roadmap

1. Done: dashboard, nightly snapshots, transparent score with tiers and
   verdicts, npm and PyPI downloads, MCP server with recommend, compare and
   trending tools.
2. Pick the product name, then publish to npm, the MCP registry and the
   Claude Code plugin marketplace. Add anonymous call counting.
3. Later: Cargo, Go and Maven adoption; release cadence in maintenance
   (mature libraries such as Pillow score low on momentum); downloads in the
   dashboard; grow the eval past 20 needs from real usage.

## License

[MIT](LICENSE).
