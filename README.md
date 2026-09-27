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
| Adoption | 25% | 70% total stars (max 100k) plus 30% forks (max 20k), both log scale. Registry downloads will join this part. |
| License | 10% | Permissive 1.0, weak copyleft 0.75, strong copyleft 0.5, unrecognised 0.5, none 0. |

Tiers: **Strong** 75 and above, **Promising** 50, **Watch** 25, **Avoid**
below 25. Archived repos are capped at 20 and get the verdict "Archived,
avoid." A missing license is always named in the verdict.

Verdicts read like "Rising fast, pushed 2 days ago, MIT" or "Slow growth, no
push in 60 days, GPL-3.0".

Caveat: opened from disk, the dashboard has no snapshot history, so momentum
uses the fallback. Scores on the Today tab are therefore provisional; the
report and the MCP server use real stars-gained figures once there are two or
more days of snapshots.

```
cd github-trending
npm run score      # top 25 repos from the latest snapshot with score and verdict
```

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

See [`github-trending/README.md`](github-trending/README.md) for the Windows
Task Scheduler command that runs it every morning.

## Repository layout

```
github-trending/dashboard/   the app, one HTML file
github-trending/lib/         score.js, shared by browser and Node
github-trending/snapshot/    snapshot job, history builder, score report, tests
docs/ideas/                  product one-pager
docs/superpowers/            implementation plans
```

## Roadmap

1. Done: dashboard, nightly snapshots, transparent score with tiers and verdicts.
2. Registry adoption: map repos to npm and PyPI packages and add weekly
   downloads to the adoption part.
3. MCP server with three tools: recommend by need, compare named repos,
   trending by period and language.
4. Publish to npm, the MCP registry and the Claude Code plugin marketplace.

## License

[MIT](LICENSE).
