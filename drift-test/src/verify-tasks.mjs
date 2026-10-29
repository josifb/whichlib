// Proves every task can tell the versions apart: its known-good solution must pass the
// task's check and its old-version solution must fail it, both run by the real runner.

import { cp } from 'node:fs/promises'
import { join } from 'node:path'
import { runDriftTest } from './runner.mjs'

// A fake agent that writes the task's stored solution (solutions/good or solutions/old) into the project.
function solutionAgent(tasksDir, kind) {
  return async ({ projectDir, task }) => {
    await cp(join(tasksDir, task.id, 'solutions', kind), projectDir, { recursive: true, force: true })
    return { tokens: null, model: `solution:${kind}` }
  }
}

const checkOutcome = ({ outcome, reason, output }) => ({ outcome, reason, output })

export async function verifyTasks({ tasksDir, only, workRoot, onResult = () => {} }) {
  const runs = {}
  for (const kind of ['good', 'old']) {
    runs[kind] = await runDriftTest({
      tasksDir,
      setups: ['alone'],
      only,
      agent: solutionAgent(tasksDir, kind),
      workRoot,
      onResult: (r) => onResult({ ...r, solution: kind }),
    })
  }
  const tasks = runs.good.results.map((good) => {
    const old = runs.old.results.find((r) => r.task === good.task)
    return {
      task: good.task,
      library: good.library,
      good: checkOutcome(good),
      old: checkOutcome(old),
      // An old solution must fail on the check, not on setup: an error proves nothing.
      ok: good.outcome === 'pass' && old.outcome === 'fail',
    }
  })
  return { ok: tasks.every((t) => t.ok), tasks }
}
