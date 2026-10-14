# whichlib plugin for Claude Code

whichlib is a dependency picker for coding agents. Before Claude adds a
library, it can ask whichlib which one to use and get GitHub repositories
ranked by a transparent 0-100 score (momentum 40%, maintenance 25%, adoption
including npm and PyPI weekly downloads 25%, license 10%), each with a tier
and a one-line verdict such as "Gaining steadily, 145M downloads/wk, pushed 3
days ago, MIT". The full breakdown is returned, so every pick can be
explained.

The plugin contains:

- **MCP server `whichlib`**, the hosted server at `https://whichlib.com/mcp`,
  with three read-only tools: `recommend_repos` (best repositories for a need
  in plain words), `compare_repos` (two to ten repositories side by side) and
  `trending_repos` (new and rising repositories).
- **Skill `choosing-dependencies`**, which tells Claude to check a new
  library with whichlib before adding it and to state the score and verdict
  it relied on.

Nothing is installed or run on your machine: the plugin connects to the
hosted server over HTTPS.

## Install

```
/plugin marketplace add josifb/whichlib-claude-plugin
/plugin install whichlib@whichlib
```

## Settings

**GitHub token (optional).** Without one you get 50 free tool calls a day.
With your own GitHub token, use is unlimited (GitHub's per-minute limits still
apply). A fine-grained token with no permissions is enough. It is stored in
your system's secure credential store and sent only to whichlib.com, as the
`X-GitHub-Token` header, which uses it for your request and never stores it.

## What it sends and what is stored

- Each tool call goes to `https://whichlib.com/mcp` with its arguments (your
  need in plain words, or the repository names to compare).
- whichlib.com sends your search text to GitHub as a search query and reads
  public data from GitHub, npm and PyPI.
- For `recommend_repos` without your own token, the need and the public name,
  description and topics of each candidate also go to TypeSafe (hosted in the
  US), which judges each candidate's fit. TypeSafe does not train on it; your
  token and IP address are never sent there.
- whichlib.com stores hashed cache keys and cached results (public data plus
  the question asked) for up to a day, and a per-day call counter per hashed
  IP address (the raw address is never stored; the hash changes every day).
- Each call adds one anonymous row to the public call counter: tool name,
  whichlib version, MCP protocol version and time. No IP, token or query.

Full details: [PRIVACY.md](https://github.com/josifb/whichlib/blob/main/PRIVACY.md).

## Run it locally instead

To keep everything on your machine, use the npm package, which needs Node.js
22 or newer:

```
claude mcp add whichlib -- npx -y whichlib
```

## License

MIT. The server, the scoring method, the evaluation and the source code live
in [josifb/whichlib](https://github.com/josifb/whichlib).
