# Privacy

whichlib runs on your machine. It has no accounts and stores nothing about
you on a server, with one exception: anonymous call counting.

## What is sent

On each tool call the MCP server sends one small record to
`https://whichlib-telemetry.todorovskijosif.workers.dev`:

- the tool name (`recommend_repos`, `compare_repos` or `trending_repos`)
- a random install id, created on first run and kept in `~/.whichlib/install-id`
- the whichlib version, the platform (for example `win32-x64`) and the Node
  major version
- a timestamp

Never your query, repository names, results, user name, file paths or any
content from your project. The collector does not store IP addresses.
Aggregate counts are public at the same address under `/stats`.

Why: whichlib's one open question is whether agents call it, so it counts
calls per anonymous install and nothing else.

## Turning it off

Set `WHICHLIB_TELEMETRY=off` or `DO_NOT_TRACK=1` in the environment of the
process that starts the server.

## Other network access

To answer a request whichlib reads public data from `api.github.com` (your
search text is sent to GitHub as a search query), `registry.npmjs.org`,
`api.npmjs.org`, `pypi.org` and `pypistats.org`. An optional GitHub token you
provide is only sent to GitHub.

At most every 12 hours it also downloads public daily star counts from
`raw.githubusercontent.com/josifb/whichlib/data/stars/` into
`~/.whichlib/stars/` (the last 10 days, a few hundred KB each). Nothing is
sent with that request. Set `WHICHLIB_HISTORY=off` to skip it. When an
agent asks `trending_repos` for `period: "rising"`, it downloads the public
rising list `raw.githubusercontent.com/josifb/whichlib/data/rising.json`
(at most once an hour); nothing is sent with that either.

## Contact

Questions or deletion requests for an install id:
https://github.com/josifb/whichlib/issues
