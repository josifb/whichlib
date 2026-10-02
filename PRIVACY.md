# Privacy

whichlib runs on your machine. It has no accounts and stores nothing about
you on a server, with one exception: anonymous call counting (and, if you
use the hosted service, what is listed under "The hosted service" below).

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

## The hosted service

whichlib also runs as a hosted service (web API and remote MCP server). For
a hosted request:

- Your search text and repository names go to GitHub as with the npm package,
  using the service's GitHub token, or yours when you send `X-GitHub-Token`.
- For recommend_repos called without your own GitHub token, your need text
  and language, plus the public name, description and topics of each
  candidate repository, go to TypeSafe (typesafe.ai, hosted in the US), which
  judges how well each candidate fits the need. TypeSafe does not train on
  this input and keeps it as long as necessary under its data processing
  terms (no fixed period is stated). Your GitHub token and IP address are
  never sent to TypeSafe, and calls made with your own token are never sent
  there. The npm package does not use TypeSafe.
- Stored: hashed cache keys and cached results (public GitHub, npm and PyPI
  data, plus the question asked, kept for up to a day); a per-day call counter per hashed IP address (SHA-256 of the
  address, a secret salt and the date, so the raw address is never stored and
  ids cannot be linked across days; older counters are deleted with the
  first call of each day).
- Your own GitHub token is used for your request only. It is never stored,
  cached or logged, and results fetched with it are never shared with other
  callers.
- The website's pages load their fonts from Google Fonts, so your browser sends its IP address to Google when you open them.
- Cloudflare, which runs the service, processes requests under its own
  privacy policy.

## Contact

Questions or deletion requests for an install id:
https://github.com/josifb/whichlib/issues
