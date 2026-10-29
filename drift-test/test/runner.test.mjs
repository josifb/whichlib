import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cp, mkdtemp, writeFile, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { rerunErrors, runDriftTest } from '../src/runner.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const tasksDir = join(here, 'fixtures', 'tasks')
const cardsDir = join(here, 'fixtures', 'cards')

const GOOD = {
  add: "export const add = (a, b) => a + b\n",
  greet: "export const greet = (name) => `Hello, ${name}!`\n",
}
const BAD = {
  add: "export const add = (a, b) => a - b\n",
  greet: "export const greet = (name) => `Hi ${name}`\n",
}

// Writes passing code only when it was given a whichlib card; otherwise failing code.
async function cardOnlyAgent({ projectDir, task, card }) {
  const code = card ? GOOD : BAD
  await writeFile(join(projectDir, `${task.id}.mjs`), code[task.id])
  return { tokens: { input: 100, output: 20 }, model: 'fake-model' }
}

async function outDir() {
  return mkdtemp(join(tmpdir(), 'drift-out-'))
}

function counts(run) {
  const bySetup = {}
  for (const r of run.results) {
    bySetup[r.setup] ??= { passed: 0, failed: 0 }
    bySetup[r.setup][r.pass ? 'passed' : 'failed']++
  }
  return bySetup
}

test('records pass or fail per task and setup, as decided by the task check', async () => {
  const run = await runDriftTest({
    tasksDir,
    cardsDir,
    setups: ['alone', 'context7', 'whichlib', 'both'],
    agent: cardOnlyAgent,
    outDir: await outDir(),
  })

  assert.equal(run.results.length, 8)
  assert.equal(run.results.find((r) => r.setup === 'alone').reason.startsWith('check failed: `node --test judge.spec.mjs` exited'), true)
  assert.deepEqual(counts(run), {
    alone: { passed: 0, failed: 2 },
    context7: { passed: 0, failed: 2 },
    whichlib: { passed: 2, failed: 0 },
    both: { passed: 2, failed: 0 },
  })
})

// Writes passing code for the tasks listed under its setup; failing code for the rest.
function scriptedAgent(passes) {
  return async ({ projectDir, task, setup }) => {
    const code = (passes[setup.id] ?? []).includes(task.id) ? GOOD : BAD
    await writeFile(join(projectDir, `${task.id}.mjs`), code[task.id])
    return { tokens: { input: 100, output: 20 }, model: 'fake-model' }
  }
}

async function runScripted(passes, setups = ['alone', 'context7', 'whichlib']) {
  const dir = await outDir()
  const run = await runDriftTest({ tasksDir, cardsDir, setups, agent: scriptedAgent(passes), outDir: dir })
  const report = await readFile(join(dir, 'report.md'), 'utf8')
  const json = JSON.parse(await readFile(join(dir, 'results.json'), 'utf8'))
  return { run, report, json }
}

test('report shows pass rate per setup and the difference vs alone and vs Context7', async () => {
  const { report, json } = await runScripted({ alone: [], context7: ['add'], whichlib: ['add', 'greet'] })

  assert.match(report, /\| alone \| 0\/2 \| 0% \| — \| -50 pts \|/)
  assert.match(report, /\| context7 \| 1\/2 \| 50% \| \+50 pts \| — \|/)
  assert.match(report, /\| whichlib \| 2\/2 \| 100% \| \+100 pts \| \+50 pts \|/)
  assert.equal(json.results.length, 6)
  assert.deepEqual(json.summary.bySetup.whichlib, { passed: 2, total: 2, errors: 0, rate: 100 })
})

test('clear win needs +20 pts vs alone and +10 pts vs Context7', async () => {
  const { report, json } = await runScripted({ alone: [], context7: ['add'], whichlib: ['add', 'greet'] })
  assert.equal(json.summary.verdict.outcome, 'clear-win')
  assert.match(report, /Clear win/)
})

test('beating only the agent alone means "use with Context7"', async () => {
  const { report, json } = await runScripted({ alone: [], context7: ['add', 'greet'], whichlib: ['add', 'greet'] })
  assert.equal(json.summary.verdict.outcome, 'use-with-context7')
  assert.match(report, /use with Context7/)
})

test('beating neither means stop and rethink', async () => {
  const { report, json } = await runScripted({ alone: ['add'], context7: ['add'], whichlib: ['add'] })
  assert.equal(json.summary.verdict.outcome, 'stop')
  assert.match(report, /Stop and rethink/)
})

test('each task runs in a fresh project copy and never sees the judge files', async () => {
  const seen = []
  const leakyAgent = async ({ projectDir, task, setup }) => {
    seen.push({ run: `${task.id}/${setup.id}`, dir: projectDir, files: (await readdir(projectDir)).sort() })
    await writeFile(join(projectDir, `${task.id}.mjs`), GOOD[task.id])
    await writeFile(join(projectDir, 'leftover.txt'), `written by ${task.id}/${setup.id}`)
    return {}
  }
  await runDriftTest({ tasksDir, cardsDir, setups: ['alone', 'whichlib'], agent: leakyAgent, outDir: await outDir() })

  assert.equal(seen.length, 4)
  assert.equal(new Set(seen.map((s) => s.dir)).size, 4)
  for (const s of seen) assert.deepEqual(s.files, ['README.md'], `${s.run} saw ${s.files}`)
})

test('a failing or hanging agent is recorded as fail with a reason, and the run continues', async () => {
  const flakyAgent = async ({ projectDir, task, setup }) => {
    if (setup.id === 'alone' && task.id === 'add') throw new Error('process exited 1')
    if (setup.id === 'alone' && task.id === 'greet') return new Promise(() => {})
    await writeFile(join(projectDir, `${task.id}.mjs`), GOOD[task.id])
    return {}
  }
  const run = await runDriftTest({
    tasksDir,
    cardsDir,
    setups: ['alone', 'whichlib'],
    agent: flakyAgent,
    agentTimeoutMs: 300,
    outDir: await outDir(),
  })

  const reason = (task, setup) => run.results.find((r) => r.task === task && r.setup === setup)
  assert.deepEqual(reason('add', 'alone'), { ...reason('add', 'alone'), pass: false, reason: 'agent error: process exited 1' })
  assert.deepEqual(reason('greet', 'alone'), { ...reason('greet', 'alone'), pass: false, reason: 'agent timed out after 0.3 s' })
  assert.equal(reason('add', 'whichlib').pass, true)
  assert.equal(reason('greet', 'whichlib').pass, true)
})

test('an agent that hits its usage limit is an error, not a fail, and pass rates leave it out', async () => {
  const agent = async ({ projectDir, task, setup }) => {
    if (setup.id === 'alone' && task.id === 'greet') return { error: "You've hit your usage limit · resets 3pm", tokens: { input: 5, output: 0 } }
    await writeFile(join(projectDir, `${task.id}.mjs`), (setup.id === 'alone' ? GOOD : BAD)[task.id])
    return {}
  }
  const dir = await outDir()
  const run = await runDriftTest({ tasksDir, cardsDir, setups: ['alone', 'whichlib'], agent, outDir: dir })

  const greet = run.results.find((r) => r.task === 'greet' && r.setup === 'alone')
  assert.equal(greet.outcome, 'error')
  assert.equal(greet.pass, false)
  assert.equal(greet.reason, "agent error: You've hit your usage limit · resets 3pm")
  assert.deepEqual(run.summary.bySetup.alone, { passed: 1, total: 1, errors: 1, rate: 100 })
  assert.deepEqual(run.summary.bySetup.whichlib, { passed: 0, total: 2, errors: 0, rate: 0 })
  assert.match(await readFile(join(dir, 'report.md'), 'utf8'), /\| alone \| 1\/1 \| 100% \| — \| — \| 1 \|/)
})

test('an agent that crashes before changing any file is an error; after changing files it is a fail', async () => {
  const agent = async ({ projectDir, task }) => {
    if (task.id === 'add') throw new Error('could not start claude: ENOENT')
    await writeFile(join(projectDir, 'greet.mjs'), BAD.greet)
    throw new Error('claude exited 1: crashed')
  }
  const run = await runDriftTest({ tasksDir, cardsDir, setups: ['alone'], agent, outDir: await outDir() })
  const outcome = (task) => run.results.find((r) => r.task === task).outcome
  assert.equal(outcome('add'), 'error')
  assert.equal(outcome('greet'), 'fail')
})

test('rerunning errors reruns only the error cases and merges them into the report', async () => {
  const dir = await outDir()
  const limited = async ({ projectDir, task, setup }) => {
    if (task.id === 'add' && setup.id === 'whichlib') return { error: 'Claude AI usage limit reached|1761742800' }
    await writeFile(join(projectDir, `${task.id}.mjs`), BAD[task.id])
    return {}
  }
  await runDriftTest({ tasksDir, cardsDir, setups: ['alone', 'whichlib'], agent: limited, outDir: dir })

  const calls = []
  const recovered = async ({ projectDir, task, setup, card }) => {
    calls.push(`${task.id}/${setup.id}/${card ? 'card' : 'no card'}`)
    await writeFile(join(projectDir, `${task.id}.mjs`), GOOD[task.id])
    return {}
  }
  // The rerun reads the tasks and cards folders from the original run unless given others.
  const run = await rerunErrors({ resultsDir: dir, agent: recovered })

  assert.deepEqual(calls, ['add/whichlib/card'])
  const json = JSON.parse(await readFile(join(dir, 'results.json'), 'utf8'))
  assert.deepEqual(json, JSON.parse(JSON.stringify(run)))
  assert.deepEqual(
    json.results.map((r) => `${r.task}/${r.setup}: ${r.outcome}`),
    ['add/alone: fail', 'add/whichlib: pass', 'greet/alone: fail', 'greet/whichlib: fail'],
  )
  assert.deepEqual(json.summary.bySetup.whichlib, { passed: 1, total: 2, errors: 0, rate: 50 })
  assert.match(await readFile(join(dir, 'report.md'), 'utf8'), /1 error rerun\b/)
})

test('an agent error that only mentions a rate limit after editing files stays a fail', async () => {
  const agent = async ({ projectDir, task }) => {
    await writeFile(join(projectDir, `${task.id}.mjs`), BAD[task.id])
    return { error: 'tests for the rate limit middleware failed' }
  }
  const run = await runDriftTest({ tasksDir, cardsDir, setups: ['alone'], agent, outDir: await outDir() })
  assert.deepEqual(run.results.map((r) => r.outcome), ['fail', 'fail'])
})

test('a failing install is an error', async () => {
  const tasks = await mkdtemp(join(tmpdir(), 'drift-tasks-'))
  await cp(join(tasksDir, 'add'), join(tasks, 'add'), { recursive: true })
  const spec = JSON.parse(await readFile(join(tasks, 'add', 'task.json'), 'utf8'))
  await writeFile(join(tasks, 'add', 'task.json'), JSON.stringify({ ...spec, install: ['node -e "process.exit(3)"'] }))
  const run = await runDriftTest({ tasksDir: tasks, cardsDir, setups: ['alone'], agent: scriptedAgent({}), outDir: await outDir() })
  assert.equal(run.results[0].outcome, 'error')
  assert.match(run.results[0].reason, /^setup error: /)
})

test('no verdict without the alone, context7 and whichlib setups', async () => {
  const { report, json } = await runScripted({ whichlib: ['add'] }, ['alone', 'whichlib'])
  assert.equal(json.summary.verdict.outcome, 'incomplete')
  assert.match(report, /No verdict/)
})
