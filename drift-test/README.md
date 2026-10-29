# Drift Test

A public, repeatable benchmark of **version drift**: code an agent writes for a
different version of a library than the one installed in the project. Each task
is a small project pinned to a recent major of a fast-moving library. The agent
gets the task prompt, writes code, and then the task's own type checker and
tests decide pass or fail. Nobody grades by opinion.

Every task runs under each **setup**:

| Setup | What the agent gets on top of the prompt |
|---|---|
| `alone` | nothing (no MCP servers) |
| `context7` | the Context7 MCP server (`https://mcp.context7.com/mcp`) and Context7's own recommended rule, appended to the system prompt |
| `whichlib` | the whichlib version card for the task's library, appended to the system prompt |
| `both` | Context7, its rule and the whichlib card |

The Context7 rule is the example from Context7's README ("Always use Context7 when I need
library/API documentation, code generation, setup or configuration steps without me having
to explicitly ask."), so Context7 is used the way it tells its users to.

## Rerun it

You need Node 22+ and [Claude Code](https://claude.com/claude-code) logged in.
The run uses your account's default model and your plan limits.

```
cd drift-test
npm run drift
```

That runs every task in `tasks/` under all four setups, with the cards in
`cards/`, and writes `results.json` and `report.md` to a new `results/<date>T<time>/`
folder. Until the real tasks and cards are committed, try it on the two
fixture tasks:
`npm run drift -- --tasks test/fixtures/tasks --cards test/fixtures/cards`.
On Windows the runner starts `claude` directly, so use Claude Code's native
installer (`claude.exe`), not the npm `claude.cmd` shim.
Set `CONTEXT7_API_KEY` to use your Context7 key.

The agent works in `--work <dir>` (default: `<temp>/drift-work`, or `drift-work` at the
drive root when the temp folder is inside your home folder, as on Windows: `C:\drift-work`).
Claude Code loads `CLAUDE.md`, `CLAUDE.local.md` and `.claude/CLAUDE.md` from every parent of
its working folder, even with `--setting-sources project`, so a folder below your home folder
would give every setup your own instructions. The runner refuses to start when it finds one
there and names the file.

Runs that fail for infrastructure reasons are recorded as **error**, not fail, and left out of
the pass rates: a usage limit, a failed install, or an agent that crashed before changing any
file. Rerun just those into the same report with
`npm run drift -- --rerun-errors results/<date>T<time>`; the report says how many were rerun.

Options:
`npm run drift -- --help` (pick setups, a model, another output folder,
the per-run timeout).

## Win rules (fixed before the first run)

whichlib wins clearly when its pass rate is at least **20 points above the agent
alone** and **10 points above Context7**. If it beats only the agent alone, it is
meant to be used together with Context7 (the `both` setup measures that). If it
does not beat the agent alone, it fails. The report prints the verdict by these
rules.

## How a run works

For each task and setup:

1. `tasks/<id>/project/` is copied to a new temporary folder. No task or setup
   ever sees another one's files.
2. The task's `install` commands run there (for example `npm ci`).
3. Claude Code runs headless in that folder (`claude -p`, permissions bypassed
   inside the throwaway folder, only the project's own settings, only the
   setup's MCP servers).
4. `tasks/<id>/judge/` (the tests) is copied in **after** the agent is done, so
   the agent never sees it, and the `check` commands run. Pass means every
   check exits 0.

A hanging agent, an agent that crashed after changing files, or a check that
times out counts as a fail with its reason in the report (errors, above, do not).
The run goes on. Tokens and time are recorded per run.

## Task format

```
tasks/<id>/
  task.json   {"library": "zod", "prompt": "...", "install": ["npm ci"], "check": ["npx tsc --noEmit", "node --test judge.test.mjs"]}
  project/    the starting project, pinned to the version under test
  judge/      tests copied in after the agent finishes (optional)
cards/<library>.md   the whichlib version card used by the whichlib and both setups
                     (<library> is the package name: prisma, tailwindcss, zod, ai, next,
                     react, vite, langchain, pydantic, sqlalchemy)
```

## Version cards

The cards in `cards/` are not written by hand. `npm run cards` builds them with
the same pipeline whichlib uses:

1. For each library in `cards/libraries.json`, collect the project's own release
   notes (GitHub releases), changelog and migration guide entries for every
   version after `from` (the last release of the previous major, the version an
   agent most likely learned) up to `to` (the version the tasks install).
2. Ask TypeSafe's Jev model (pinned version) one yes/no question per entry: must a
   project change its own code, configuration or setup to keep working? Entries
   at 0.3 or above count as breaking changes.
3. Write the card: one header line, then the breaking changes, most likely
   breaking first, each with its version and a link to its source, trimmed to
   about 1,500 tokens with a note when trimmed.

`cards/index/<package>.json` keeps every entry with its source link and Jev
probability, so the result can be checked line by line. A rerun reuses those
judgments and makes no new Jev calls for entries it has seen.

```
GITHUB_TOKEN="$(gh auth token)" TYPESAFE_API_KEY=... npm run cards
npm run cards -- --render-only     # rewrite the cards from cards/index, no network
```

## Tests

`npm test` runs the runner on two tiny fixture tasks with a fake agent. No
network, no Claude account.
