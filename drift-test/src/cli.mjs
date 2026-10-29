#!/usr/bin/env node
// npm run drift -- [--tasks dir] [--cards dir] [--setups alone,context7,whichlib,both] [--out dir] [--model name] [--work dir]
// npm run drift -- --rerun-errors <results dir>

import { parseArgs } from 'node:util'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { rerunErrors, runDriftTest, SETUPS } from './runner.mjs'
import { createClaudeCodeAgent } from './claude-code.mjs'
import { defaultWorkDir, prepareWorkDir } from './work-dir.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const { values } = parseArgs({
  options: {
    tasks: { type: 'string' },
    cards: { type: 'string' },
    setups: { type: 'string', default: Object.keys(SETUPS).join(',') },
    out: { type: 'string' },
    model: { type: 'string' },
    'agent-timeout': { type: 'string', default: '900' },
    work: { type: 'string', default: defaultWorkDir() },
    'rerun-errors': { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  },
})

if (values.help) {
  console.log(`Usage: npm run drift -- [options]

  --tasks <dir>          task folders (default: tasks/)
  --cards <dir>          whichlib version cards, one <library>.md each (default: cards/)
  --setups <list>        any of ${Object.keys(SETUPS).join(', ')} (default: all)
  --out <dir>            where results.json and report.md go (default: results/<date>T<time>/)
  --model <name>         Claude Code model (default: the account's default model)
  --agent-timeout <s>    seconds before one agent run counts as failed (default: 900)
  --work <dir>           where the agent works; no CLAUDE.md, CLAUDE.local.md or .claude/CLAUDE.md may sit in it
                         or any parent (default: ${defaultWorkDir()})
  --rerun-errors <dir>   rerun only the runs recorded as "error" in that results folder and
                         merge them into its results.json and report.md; uses that run's tasks
                         and cards folders unless --tasks/--cards are given (pass the same --model)`)
  process.exit(0)
}

const timeoutSeconds = Number(values['agent-timeout'])
if (!(timeoutSeconds > 0)) {
  console.error(`--agent-timeout must be a positive number of seconds, got "${values['agent-timeout']}"`)
  process.exit(2)
}
let workRoot
try {
  workRoot = await prepareWorkDir(resolve(values.work))
} catch (err) {
  console.error(err.message)
  process.exit(2)
}
const common = {
  agent: createClaudeCodeAgent({ model: values.model }),
  agentTimeoutMs: timeoutSeconds * 1000,
  workRoot,
  onResult: (r) =>
    console.log(`${r.outcome.toUpperCase().padEnd(5)}  ${r.task} / ${r.setup}  ${Math.round((r.durationMs ?? 0) / 1000)} s${r.reason ? '  ' + r.reason : ''}`),
}

let out, run
if (values['rerun-errors']) {
  out = resolve(values['rerun-errors'])
  // Without --tasks/--cards the rerun uses the folders the original run recorded.
  const dir = (name) => values[name] && resolve(values[name])
  run = await rerunErrors({ ...common, resultsDir: out, tasksDir: dir('tasks'), cardsDir: dir('cards') })
  const last = run.reruns.at(-1)
  console.log(`rerun ${last.rerun} errors, ${last.stillErrors} left`)
} else {
  // One folder per run, so two runs on the same day never overwrite each other.
  const stamp = new Date().toISOString().slice(0, 16).replace(':', '-')
  out = resolve(values.out ?? join(root, 'results', stamp))
  run = await runDriftTest({
    ...common,
    tasksDir: resolve(values.tasks ?? join(root, 'tasks')),
    cardsDir: resolve(values.cards ?? join(root, 'cards')),
    setups: values.setups.split(',').map((s) => s.trim()).filter(Boolean),
    outDir: out,
  })
}

for (const [id, s] of Object.entries(run.summary.bySetup)) console.log(`${id}: ${s.passed}/${s.total} (${s.rate}%), ${s.errors} errors`)
console.log(`verdict: ${run.summary.verdict.outcome}`)
console.log(`report: ${join(out, 'report.md')}`)
