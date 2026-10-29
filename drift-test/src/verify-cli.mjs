#!/usr/bin/env node
// npm run verify-tasks -- [--only <task or library,...>] [--tasks dir] [--work dir]
// Runs every task's known-good and old-version solutions through the runner; exits 1 unless
// each good solution passes and each old one fails.

import { parseArgs } from 'node:util'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifyTasks } from './verify-tasks.mjs'
import { defaultWorkDir, prepareWorkDir } from './work-dir.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const { values } = parseArgs({
  options: {
    tasks: { type: 'string' },
    only: { type: 'string' },
    work: { type: 'string', default: defaultWorkDir() },
  },
})

const run = await verifyTasks({
  tasksDir: resolve(values.tasks ?? join(root, 'tasks')),
  only: values.only?.split(',').map((s) => s.trim()).filter(Boolean),
  workRoot: await prepareWorkDir(resolve(values.work)),
  onResult: (r) =>
    console.log(`${r.solution.padEnd(4)} ${r.outcome.toUpperCase().padEnd(5)}  ${r.task}${r.reason ? '  ' + r.reason : ''}`),
})

for (const t of run.tasks.filter((t) => !t.ok)) {
  console.log(`\n--- ${t.task}: good ${t.good.outcome}, old ${t.old.outcome}`)
  for (const kind of ['good', 'old']) if (t[kind].output) console.log(`[${kind}] ${t[kind].reason}\n${t[kind].output}`)
}
console.log(`\n${run.tasks.filter((t) => t.ok).length}/${run.tasks.length} tasks verified`)
process.exit(run.ok ? 0 : 1)
