# whichlib plugin for Claude Code

Bundles the whichlib MCP server (`npx -y whichlib`, Node 22+) and a
`choosing-dependencies` skill that makes Claude check a library with
whichlib before adding it.

```
/plugin marketplace add josifb/whichlib
/plugin install whichlib@whichlib
```

Optional: set `GITHUB_TOKEN` in your environment to raise GitHub's search
limit. See the main [README](../README.md) for the score, the tools and
telemetry opt-out.
