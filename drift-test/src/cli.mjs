#!/usr/bin/env node
// npm run drift -- [--tasks dir] [--cards dir] [--setups alone,context7,whichlib,both] [--out dir] [--model name]

import { parseArgs } from 'node:util'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runDriftTest, SETUPS } from './runner.mjs'
import { createClaudeCodeAgent } from './claude-code.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const { values } = parseArgs({
  options: {
    tasks: { type: 'string', default: join(root, 'tasks') },
    cards: { type: 'string', default: join(root, 'cards') },
    setups: { type: 'string', default: Object.keys(SETUPS).join(',') },
    out: { type: 'string' },
    model: { type: 'string' },
    'agent-timeout': { type: 'string', default: '900' },
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
  --agent-timeout <s>    seconds before one agent run counts as failed (default: 900)`)
  process.exit(0)
}

const timeoutSeconds = Number(values['agent-timeout'])
if (!(timeoutSeconds > 0)) {
  console.error(`--agent-timeout must be a positive number of seconds, got "${values['agent-timeout']}"`)
  process.exit(2)
}
// One folder per run, so two runs on the same day never overwrite each other.
const stamp = new Date().toISOString().slice(0, 16).replace(':', '-')
const out = resolve(values.out ?? join(root, 'results', stamp))
const run = await runDriftTest({
  tasksDir: resolve(values.tasks),
  cardsDir: resolve(values.cards),
  setups: values.setups.split(',').map((s) => s.trim()).filter(Boolean),
  agent: createClaudeCodeAgent({ model: values.model }),
  agentTimeoutMs: timeoutSeconds * 1000,
  outDir: out,
  onResult: (r) =>
    console.log(`${r.pass ? 'pass' : 'FAIL'}  ${r.task} / ${r.setup}  ${Math.round((r.durationMs ?? 0) / 1000)} s${r.reason ? '  ' + r.reason : ''}`),
})

for (const [id, s] of Object.entries(run.summary.bySetup)) console.log(`${id}: ${s.passed}/${s.total} (${s.rate}%)`)
console.log(`verdict: ${run.summary.verdict.outcome}`)
console.log(`report: ${join(out, 'report.md')}`)
