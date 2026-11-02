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

You need Node 22+, [uv](https://docs.astral.sh/uv/) (for the Python tasks) and
[Claude Code](https://claude.com/claude-code) logged in.
The run uses your account's default model and your plan limits.

```
cd drift-test
npm run drift
```

That runs every task in `tasks/` under all four setups, with the cards in
`cards/`, and writes `results.json` and `report.md` to a new `results/<date>T<time>/`
folder. `--only prisma,zod-signup-form` runs just those libraries or tasks. To try the
runner without spending much, use the two fixture tasks:
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

`results.json` and `report.md` are saved after every finished task, so a run that stops
(machine asleep, out of memory, Ctrl+C) loses nothing: continue it with
`npm run drift -- --resume results/<date>T<time>`, which runs only the missing tasks with the
same tasks, cards, setups and `--only` selection. Until it finishes, the report says "unfinished".

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
  task.json   {"library": "zod", "prompt": "...", "install": ["npm ci"], "check": ["npx tsc --noEmit", "npx tsx --test drift-judge/*.test.ts"]}
  project/    the starting project, with a lockfile pinning the version under test
  judge/      tests copied in after the agent finishes (optional); the real tasks keep them in judge/drift-judge/
  solutions/good/  files that solve the task for the installed version
  solutions/old/   files that solve it the way the previous major wanted
cards/<library>.md   the whichlib version card used by the whichlib and both setups
                     (<library> is the package name: prisma, tailwindcss, zod, ai, next,
                     react, vite, langchain, pydantic, sqlalchemy)
```

The agent never sees `judge/` or `solutions/`: only `project/` is copied into its folder.

## The 30 tasks

Three small projects per library, each pinned to the version its card was built for
(`cards/libraries.json`: `to`). Each prompt asks for an everyday feature in the area people
complain about, and never names a version or a change; the agent has to notice what is
installed. The JavaScript tasks are judged by `tsc` (or the build) and tests; the Python tasks
by pytest, run with `uv`.

| Task | The previous major's way, which fails here |
|---|---|
| `zod-signup-form` | `required_error` / `invalid_type_error` params, `error.errors` |
| `zod-server-config` | `z.string().ip()`, `.cidr()`, one-argument `z.record()` |
| `zod-order-errors` | `errorMap` param, `error.errors` |
| `prisma-todo-setup` | `url` in the schema's datasource, `prisma-client-js`, `new PrismaClient()` from `@prisma/client` |
| `prisma-seed` | seed command in the `prisma` key of package.json (ignored, nothing is seeded); the check seeds twice to catch duplicates |
| `prisma-blog-queries` | `PrismaClient` from `@prisma/client` with `datasourceUrl` |
| `tailwind-brand-setup` | `@tailwind` directives and `tailwind.config.js` (the build emits no utilities) |
| `tailwind-dark-toggle` | `darkMode: 'class'` in `tailwind.config.js` (ignored) |
| `tailwind-postcss-utility` | `tailwindcss` as the PostCSS plugin, `@layer utilities` |
| `ai-support-chat` | system prompt as a `system` message inside `messages` (rejected) |
| `ai-usage-report` | `totalUsage.cachedInputTokens` / `reasoningTokens` |
| `ai-tool-context` | `experimental_context` |
| `next-product-page` | synchronous `params` (renders the page without the product) |
| `next-admin-actions` | one-argument `revalidateTag`, synchronous `cookies()` |
| `next-lint-script` | `next lint` |
| `react-mount-app` | `ReactDOM.render`, `hydrate`, `unmountComponentAtNode` |
| `react-stopwatch` | `useRef()` without an argument |
| `react-item-refs` | ref callback that returns the assigned value |
| `vite-vendor-chunk` | object form of `rollupOptions.output.manualChunks` |
| `vite-drop-console` | `esbuild.drop` (ignored, the logs stay) |
| `vite-keep-names` | `esbuild.keepNames` (ignored, names are mangled) |
| `langchain-tool-agent` | `AgentExecutor`, `create_tool_calling_agent` |
| `langchain-summarize` | `langchain.prompts`, `LLMChain` |
| `langchain-chat-memory` | `ConversationChain`, `ConversationBufferMemory` |
| `pydantic-booking` | `@root_validator` without `skip_on_failure`, `class Config` |
| `pydantic-settings-env` | `BaseSettings` from `pydantic` |
| `pydantic-catalog` | `__root__` models, `constr(regex=...)` |
| `sqlalchemy-active-users` | SQL strings passed to `execute()`, `engine.execute()` |
| `sqlalchemy-add-user` | writes on `engine.connect()` without a commit (rolled back) |
| `sqlalchemy-order-report` | `select([...])` with a list |

`npm run verify-tasks` proves each task tells the versions apart: it runs every task's good
solution and old solution through the runner (with a fake agent that writes the solution) and
fails unless every good solution passes and every old one fails its check. It installs every
project twice, so it takes a while; `--only` narrows it.

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

`npm test` runs the runner on two tiny fixture tasks with a fake agent and checks the
task set (three per library, every prompt free of version hints, every lockfile pinning
the card's version). No network, no Claude account.
