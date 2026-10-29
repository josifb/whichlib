// Drift Test runner: every task under every setup, each in a fresh project copy,
// judged only by the task's own check commands (type checker and tests).

import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { formatSeconds, runCommand } from './command.mjs'
import { renderReport, summarize } from './report.mjs'

// What each setup gives the agent on top of the task prompt.
export const SETUPS = {
  alone: { id: 'alone', context7: false, whichlib: false },
  context7: { id: 'context7', context7: true, whichlib: false },
  whichlib: { id: 'whichlib', context7: false, whichlib: true },
  both: { id: 'both', context7: true, whichlib: true },
}

const DEFAULT_AGENT_TIMEOUT_MS = 15 * 60_000
const DEFAULT_CHECK_TIMEOUT_MS = 5 * 60_000

export async function loadTasks(tasksDir) {
  const entries = await readdir(tasksDir, { withFileTypes: true })
  const tasks = []
  for (const entry of entries.filter((e) => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const dir = join(tasksDir, entry.name)
    const spec = JSON.parse(await readFile(join(dir, 'task.json'), 'utf8'))
    if (!spec.library || !spec.prompt || !Array.isArray(spec.check) || spec.check.length === 0) {
      throw new Error(`${entry.name}/task.json needs "library", "prompt" and a non-empty "check" list`)
    }
    tasks.push({ id: entry.name, dir, install: [], ...spec })
  }
  if (tasks.length === 0) throw new Error(`no tasks in ${tasksDir} (expected one folder per task with a task.json)`)
  return tasks
}

async function exists(path) {
  return stat(path).then(() => true, () => false)
}

async function loadCards(tasks, setups, cardsDir) {
  const cards = new Map()
  if (!setups.some((s) => s.whichlib)) return cards
  for (const library of new Set(tasks.map((t) => t.library))) {
    const path = cardsDir && join(cardsDir, `${library}.md`)
    if (!path || !(await exists(path))) {
      throw new Error(`no version card for "${library}": expected ${path ?? '<cardsDir>/' + library + '.md'}`)
    }
    cards.set(library, await readFile(path, 'utf8'))
  }
  return cards
}

class AgentTimeout extends Error {}

// Runs the agent with a hard deadline; a hung agent is aborted and reported.
async function runAgent(agent, input, timeoutMs) {
  const controller = new AbortController()
  let timer
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      reject(new AgentTimeout(`agent timed out after ${formatSeconds(timeoutMs)}`))
    }, timeoutMs)
  })
  try {
    return await Promise.race([agent({ ...input, signal: controller.signal }), deadline])
  } finally {
    clearTimeout(timer)
  }
}

// Messages from Claude Code that mean the account, not the agent, stopped the run.
// Kept narrow: a task's own test output may well mention "rate limit".
const USAGE_LIMIT = /usage limit|hit your limit|credit balance is too low/i

// Folders the agent's own code never lives in; skipping them keeps the snapshot cheap.
const NOT_PROJECT_CODE = new Set(['node_modules', '.git', '.venv', 'venv', '__pycache__'])

// Path, size and mtime of every project file: two equal snapshots mean the agent changed nothing.
// null when the folder cannot be read (e.g. a file still locked by a killed agent): then nobody
// can say the agent changed nothing, and the run stays a fail.
const snapshot = (dir) => listFiles(dir).catch(() => null)

async function listFiles(dir, prefix = '') {
  const parts = []
  for (const entry of await readdir(join(dir, prefix), { withFileTypes: true })) {
    if (NOT_PROJECT_CODE.has(entry.name)) continue
    const rel = join(prefix, entry.name)
    if (entry.isDirectory()) parts.push(await listFiles(dir, rel))
    else {
      const s = await stat(join(dir, rel))
      parts.push(`${rel}:${s.size}:${s.mtimeMs}`)
    }
  }
  return parts.sort().join('\n')
}

async function runChecks(commands, cwd, timeoutMs) {
  for (const command of commands) {
    const result = await runCommand(command, { cwd, timeoutMs })
    if (!result.ok) return { ok: false, reason: `check failed: \`${command}\` ${result.why}`, output: result.output }
  }
  return { ok: true }
}

async function runOne({ task, setup, card, agent, workRoot, agentTimeoutMs, checkTimeoutMs }) {
  const projectDir = await mkdtemp(join(workRoot, `${task.id}-${setup.id}-`))
  // Outcomes: "pass" and "fail" are the agent's; "error" is infrastructure (usage limit, failed
  // install, agent crash before any edit). Errors are left out of pass rates and can be rerun.
  const record = { task: task.id, library: task.library, setup: setup.id, outcome: 'fail', pass: false, reason: null }
  try {
    await cp(join(task.dir, 'project'), projectDir, { recursive: true })
    const install = await runChecks(task.install, projectDir, checkTimeoutMs)
    if (!install.ok) {
      return { ...record, outcome: 'error', reason: `setup error: ${install.reason}`, output: install.output }
    }

    const before = await snapshot(projectDir)
    // A usage limit, or a crash that left the project untouched, is not the agent's fault.
    const agentError = async (message) => {
      const failed = { ...record, reason: `agent error: ${message}` }
      const untouched = before !== null && (await snapshot(projectDir)) === before
      const infra = USAGE_LIMIT.test(message) || untouched
      return infra ? { ...failed, outcome: 'error' } : failed
    }
    let usage
    const started = Date.now()
    try {
      usage = await runAgent(
        agent,
        { projectDir, prompt: task.prompt, task: { id: task.id, library: task.library }, setup, card },
        agentTimeoutMs,
      )
    } catch (err) {
      if (err instanceof AgentTimeout) return { ...record, reason: err.message }
      return agentError(err.message)
    } finally {
      // Agent time only: copying and installing the project are not counted.
      record.durationMs = Date.now() - started
    }
    record.tokens = usage?.tokens ?? null
    record.costUsd = usage?.costUsd ?? null
    record.model = usage?.model ?? null
    if (usage?.error) return agentError(usage.error)

    // The judge files are copied in only after the agent is done, so it never sees them.
    if (await exists(join(task.dir, 'judge'))) {
      await cp(join(task.dir, 'judge'), projectDir, { recursive: true, force: true })
    }
    const check = await runChecks(task.check, projectDir, checkTimeoutMs)
    return check.ok ? { ...record, outcome: 'pass', pass: true } : { ...record, reason: check.reason, output: check.output }
  } finally {
    await rm(projectDir, { recursive: true, force: true, maxRetries: 3 }).catch(() => {})
  }
}

function resolveSetup(id) {
  if (!SETUPS[id]) throw new Error(`unknown setup "${id}"; known: ${Object.keys(SETUPS).join(', ')}`)
  return SETUPS[id]
}

// Runs each (task, setup) pair in order, each in a fresh folder under workRoot (a temp folder if none).
async function runPairs(pairs, { cards, agent, workRoot, agentTimeoutMs, checkTimeoutMs, onResult }) {
  const root = workRoot ?? (await mkdtemp(join(tmpdir(), 'drift-test-')))
  const results = []
  try {
    for (const { task, setup } of pairs) {
      const card = setup.whichlib ? cards.get(task.library) : null
      const result = await runOne({ task, setup, card, agent, workRoot: root, agentTimeoutMs, checkTimeoutMs })
      results.push(result)
      onResult(result)
    }
  } finally {
    if (!workRoot) await rm(root, { recursive: true, force: true }).catch(() => {})
  }
  return results
}

async function writeRun(outDir, run) {
  await mkdir(outDir, { recursive: true })
  await writeFile(join(outDir, 'results.json'), JSON.stringify(run, null, 2) + '\n')
  await writeFile(join(outDir, 'report.md'), renderReport(run))
}

export async function runDriftTest({
  tasksDir,
  cardsDir,
  setups: setupIds = ['alone', 'context7', 'whichlib'],
  agent,
  outDir,
  workRoot,
  agentTimeoutMs = DEFAULT_AGENT_TIMEOUT_MS,
  checkTimeoutMs = DEFAULT_CHECK_TIMEOUT_MS,
  onResult = () => {},
}) {
  const setups = setupIds.map(resolveSetup)
  const tasks = await loadTasks(tasksDir)
  const cards = await loadCards(tasks, setups, cardsDir)

  const startedAt = new Date().toISOString()
  const pairs = tasks.flatMap((task) => setups.map((setup) => ({ task, setup })))
  const results = await runPairs(pairs, { cards, agent, workRoot, agentTimeoutMs, checkTimeoutMs, onResult })

  const run = {
    startedAt,
    finishedAt: new Date().toISOString(),
    setups: setupIds,
    tasksDir,
    cardsDir,
    tasks: tasks.length,
    summary: summarize(results, setupIds),
    results,
  }
  if (outDir) await writeRun(outDir, run)
  return run
}

// Reruns only the runs recorded as "error" in an earlier results folder, puts the new
// results in their place, and rewrites results.json and report.md there. Tasks and cards
// come from the original run's folders unless others are given.
export async function rerunErrors({
  resultsDir,
  tasksDir,
  cardsDir,
  agent,
  workRoot,
  agentTimeoutMs = DEFAULT_AGENT_TIMEOUT_MS,
  checkTimeoutMs = DEFAULT_CHECK_TIMEOUT_MS,
  onResult = () => {},
}) {
  const run = JSON.parse(await readFile(join(resultsDir, 'results.json'), 'utf8'))
  tasksDir ??= run.tasksDir
  cardsDir ??= run.cardsDir
  if (!tasksDir) throw new Error(`${resultsDir}/results.json does not say which tasks folder it ran; pass one`)
  const errors = run.results.filter((r) => r.outcome === 'error')
  const allTasks = await loadTasks(tasksDir)
  const pairs = errors.map((r) => {
    const task = allTasks.find((t) => t.id === r.task)
    if (!task) throw new Error(`task "${r.task}" from ${resultsDir} is not in ${tasksDir}`)
    return { task, setup: resolveSetup(r.setup) }
  })
  const cards = await loadCards(
    pairs.map((p) => p.task),
    pairs.map((p) => p.setup),
    cardsDir,
  )

  const at = new Date().toISOString()
  const fresh = await runPairs(pairs, { cards, agent, workRoot, agentTimeoutMs, checkTimeoutMs, onResult })
  const results = run.results.map((r) => fresh.find((f) => f.task === r.task && f.setup === r.setup) ?? r)
  const merged = {
    ...run,
    finishedAt: new Date().toISOString(),
    summary: summarize(results, run.setups),
    reruns: [...(run.reruns ?? []), { at, rerun: errors.length, stillErrors: fresh.filter((r) => r.outcome === 'error').length }],
    results,
  }
  await writeRun(resultsDir, merged)
  return merged
}
