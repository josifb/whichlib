# Releasing whichlib

Everything below the line "you run" needs your own accounts. Nothing here is
automated on purpose: publishing is outward-facing and should be a decision.

## Before the first release

- [ ] Trademark check for "whichlib" (USPTO and EUIPO search pages, five minutes).
- [ ] `cd whichlib && npm test && npm run mcp:smoke` green.
- [ ] `npm pack --dry-run` shows ~20 files, no dashboard, tests or eval data.
- [ ] Version in `whichlib/package.json` and `whichlib/server.json` match.
- [x] Repository public (2026-09-27). Internal documents (one-pager, plans,
      marketing context) live in the private repository josifb/whichlib-internal
      and are git-ignored here.

## Call counter

Deployed 2026-09-27: https://whichlib-telemetry.todorovskijosif.workers.dev
(`/stats` for the numbers). `DEFAULT_ENDPOINT` in `whichlib/mcp/telemetry.mjs`
points at it. Redeploy steps are in `telemetry/README.md`.

## npm

```
cd whichlib
npm login                    # once; use an account with 2FA
npm publish                  # publishConfig.access is already "public"
npx -y whichlib              # from another folder: should print "whichlib MCP 0.1.0 ready" on stderr
```

## MCP registry

The registry hosts metadata only, so npm must be published first. Ownership
is proven by `"mcpName": "io.github.josifb/whichlib"` in the published
package.json (already there).

PowerShell, in `whichlib/`:

```
$arch = if ([System.Runtime.InteropServices.RuntimeInformation]::ProcessArchitecture -eq "Arm64") { "arm64" } else { "amd64" }
Invoke-WebRequest -Uri "https://github.com/modelcontextprotocol/registry/releases/latest/download/mcp-publisher_windows_$arch.tar.gz" -OutFile mcp-publisher.tar.gz
tar xf mcp-publisher.tar.gz mcp-publisher.exe; rm mcp-publisher.tar.gz
.\mcp-publisher login github      # must be the josifb account
.\mcp-publisher publish           # reads server.json in the current folder
```

Check: https://registry.modelcontextprotocol.io/v0/servers?search=whichlib

## After publishing

- [ ] Update the install lines in both READMEs if anything differs from `npx -y whichlib`.
- [x] npm: whichlib@0.1.0 published 2026-09-27.
- [x] MCP registry: io.github.josifb/whichlib 0.1.0 published 2026-09-27 (description max 100 chars).
- [x] 0.1.1 published 2026-09-28: npm, GitHub release v0.1.1, plugin pin. npm took
  about 3 minutes to show a new version; `npm login` again first if `npm whoami`
  returns 401 (publish then fails with a misleading E404). The MCP registry JWT
  also expires: rerun `mcp-publisher login github` before publishing.
- [x] Claude Code plugin marketplace and the awesome-mcp lists (`/directory-submissions` skill has the list and a tracker).
- [ ] Announce (`/launch` skill, uses `.agents/product-marketing.md`).
- [ ] Four weeks later: weekly active installs and calls per install decide the team tier.

## Each later release

1. Bump `version` in `whichlib/package.json` and `whichlib/server.json` (same value),
   in `whichlib/mcpb/manifest.json`, and in `claude-plugin/.claude-plugin/plugin.json`
   plus the pinned `whichlib@<version>` in `claude-plugin/.mcp.json` (the Claude
   plugin directory rejects an unpinned npx package).
2. `npm test`, `npm run mcp:smoke`, `claude plugin validate ./claude-plugin --strict`,
   commit, tag `v<version>`, push.
3. `npm publish`, then `mcp-publisher publish`. Only after npm has the new
   version: push the plugin pin (the directory picks up the new commit).
4. `npm run bundle`, then `SMITHERY_API_KEY=... npm run publish:smithery`.
   Glama builds a new release itself from the GitHub release.
