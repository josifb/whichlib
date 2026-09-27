# Fresh Repos

A dashboard you open every day showing the most-starred GitHub repositories
created in the last 24 hours, 7 days and 30 days, with sorting by stars,
stars per day, forks, open issues, created date, last push, language and
license. Plus a nightly job that stores a daily snapshot so velocity can be
computed later.

This is step 1 of the plan in `../docs/ideas/dependency-picker-for-agents.md`.

## Open the dashboard

Double-click `dashboard/index.html`. It works from disk, no server needed.
It talks directly to the GitHub Search API, which allows 10 requests per minute
without a token. Each tab and language combination is one request and is cached
in the browser for 60 minutes.

Optional: paste a GitHub token under **Settings** to raise the limit to
30 requests per minute. A fine-grained token with no permissions is enough.
It is stored only in your browser's local storage.

Tip: pin the file as a browser bookmark or set it as a new-tab page.

## What the numbers mean

- **Trending** here means "created in the period, ranked by stars". This is what
  the Search API supports. GitHub's own trending page ranks by stars gained in
  the period, which has no API. Our daily snapshots will replace that.
- **Rank (#)** is always the stars rank, so after sorting by another column you
  still see where a repo stands.
- **Stars/day** is stars divided by the repo's age in days. A rough velocity.
- **Downloads** do not exist for repositories on GitHub, only for release
  files. Forks are the nearest public signal.

## Snapshot job

```
npm test           # 16 unit tests, no network
npm run snapshot   # 27 queries (3 periods x 9 languages), ~3 min without a token
```

Set `GITHUB_TOKEN` in the environment to run it in about one minute.
Output: `data/snapshots/YYYY-MM-DD.json` with, per period and language, the
total match count and the top 100 repos (name, url, description, language,
stars, forks, open issues, license, created, pushed, archived, topics).

### Run it every morning (Windows Task Scheduler)

Run once from an elevated or normal PowerShell:

```
schtasks /Create /SC DAILY /ST 07:00 /TN "GitHub Trending Snapshot" /TR "cmd /c cd /d E:\private\github-trending && node snapshot\src\run.mjs >> data\snapshot.log 2>&1"
```

Remove with `schtasks /Delete /TN "GitHub Trending Snapshot" /F`.

## Layout

```
dashboard/index.html       the app, single file, no build step
snapshot/src/query.mjs     what "trending" means: periodStart, buildSearchQuery, searchUrl
snapshot/src/normalize.mjs raw API item -> stored record
snapshot/src/github.mjs    fetch with rate-limit wait-and-retry
snapshot/src/run.mjs       CLI: periods x languages -> data/snapshots/<date>.json
snapshot/test/             node:test suites for the above
data/snapshots/            one JSON file per day
```

## Next steps

1. Score: momentum from consecutive snapshots, maintenance (days since push,
   issue ratio), license, archived. Show it in the dashboard.
2. MCP server with three tools: recommend by need, compare named repos,
   trending by period and language.
3. Publish to npm, the MCP registry and the Claude Code plugin marketplace.
