# whichlib call counter

The one number the product plan depends on is whether agents call the tool:
weekly active installs and calls per install. This folder is the collector, a
Cloudflare Worker writing to a D1 (SQLite) database. Both are on the free
tier. Deployed 2026-09-27 at:

    https://whichlib-telemetry.todorovskijosif.workers.dev

`GET /stats` on that URL returns the aggregate numbers as JSON (weekly
installs and calls, calls by tool, totals). It is public on purpose: the
numbers the product is judged by should be visible.

## What the MCP server sends

One small POST per tool call, fire-and-forget, 2-second timeout:

```json
{ "tool": "recommend_repos", "installId": "<random uuid per machine>", "version": "0.1.0", "platform": "win32-x64", "node": "22", "protocolVersion": "2026-07-28", "ts": "2026-09-27T12:00:00.000Z" }
```

Never sent: the query, repository names, results, user names, file paths,
tokens. The worker does not store IP addresses or headers. Events with an
unknown tool name or a malformed install id are dropped. A `protocolVersion`
that is not a date is stored as null (unknown); clients before 0.2.0 do not
send one.

Users turn it off with `WHICHLIB_TELEMETRY=off` or `DO_NOT_TRACK=1`.

## Hosted calls

The hosted Worker (`api/`) shares this database. For every tool call that
passes its limits it writes one row directly to D1 (no POST):
`install_id = 'hosted'`, `source = 'hosted'`, `platform = 'hosted'`, the tool
name and the whichlib version. No IP, hash, token or query is stored.
The npm collector's rows have `source = 'npm'` (the column default).

In `/stats`, `installs` and `calls` count npm rows only; `hostedCalls` (in
`totals` and each `weekly` entry) and `bySource` are new. `byTool` and `bySource` count all sources, while `totals.calls` and weekly `calls` are npm only, so do not add them up.

The `source` column needs a one-time migration on the live database (a fresh
install gets it from `schema.sql`):

```
npx wrangler d1 execute whichlib-events --remote --file migrations/2026-10-02-source.sql
```

Applied to the live database on 2026-10-02 at 16:57 UTC (98 existing rows, all labelled `npm`).

Applied: not yet (Task 6 Step 3 adds the date it was applied).

## Files

- `worker.mjs`: the collector and the `/stats` endpoint.
- `schema.sql`: the `events` table and its indexes, applied once.
- `wrangler.toml`: worker name and the D1 binding.

## Deploy or redeploy

```
cd telemetry
npx wrangler login                                                  # once
npx wrangler d1 create whichlib-events                              # once; put the id in wrangler.toml
npx wrangler d1 execute whichlib-events --remote --file schema.sql  # once
npx wrangler deploy
```

If the worker URL ever changes, update `DEFAULT_ENDPOINT` in
`whichlib/mcp/telemetry.mjs` and publish a new whichlib version.

## Read the numbers

```
curl https://whichlib-telemetry.todorovskijosif.workers.dev/stats
npx wrangler d1 execute whichlib-events --remote --command "SELECT strftime('%Y-%W', ts) AS week, COUNT(DISTINCT install_id) AS installs, COUNT(*) AS calls FROM events GROUP BY week ORDER BY week"
```

Decision rule from the one-pager: watch weekly active installs and calls per
install for four weeks after launch.

## Lesson from the first deploy

Creating the schema from inside the worker did not work reliably: D1's
`exec()` splits statements on newlines, and a cached `batch()` promise hid a
failure. A schema file applied with wrangler is the dependable way.
