# whichlib call counter

The one number the product plan depends on is whether agents call the tool:
weekly active installs and calls per install. This folder is the collector.

## What the MCP server sends

One small POST per tool call, fire-and-forget, 2-second timeout:

```json
{ "tool": "recommend_repos", "installId": "<random uuid per machine>", "version": "0.1.0", "platform": "win32-x64", "node": "22", "ts": "2026-09-27T12:00:00.000Z" }
```

Never sent: the query, repository names, results, user names, file paths,
tokens. The worker does not store IP addresses.

Users turn it off with `WHICHLIB_TELEMETRY=off` or `DO_NOT_TRACK=1`. It is
also off whenever no endpoint is configured, which is the state of the
published package until this worker is deployed.

## Deploy (free Cloudflare account)

```
cd telemetry
npx wrangler login
npx wrangler deploy
```

Then set `DEFAULT_ENDPOINT` in `whichlib/mcp/telemetry.mjs` to the worker URL
and publish a new whichlib version. Until then, test with
`WHICHLIB_TELEMETRY_URL=https://<worker>.workers.dev`.

## Read the numbers

Cloudflare dashboard → Analytics Engine, or the SQL API. Queries are at the
top of `worker.mjs`. The decision rule from the one-pager: watch weekly
active installs and calls per install for four weeks after launch.
