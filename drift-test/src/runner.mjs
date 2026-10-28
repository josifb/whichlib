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

async function runChecks(commands, cwd, timeoutMs) {
  for (const command of commands) {
    const result = await runCommand(command, { cwd, timeoutMs })
    if (!result.ok) return { ok: false, reason: `check failed: \`${command}\` ${result.why}`, output: result.output }
  }
  return { ok: true }
}

async function runOne({ task, setup, card, agent, workRoot, agentTimeoutMs, checkTimeoutMs }) {
  const projectDir = await mkdtemp(join(workRoot, `${task.id}-${setup.id}-`))
  const record = { task: task.id, library: task.library, setup: setup.id, pass: false, reason: null }
  try {
    await cp(join(task.dir, 'project'), projectDir, { recursive: true })
    const install = await runChecks(task.install, projectDir, checkTimeoutMs)
    if (!install.ok) {
      return { ...record, reason: `setup error: ${install.reason}`, output: install.output }
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
      return { ...record, reason: err instanceof AgentTimeout ? err.message : `agent error: ${err.message}` }
    } finally {
      // Agent time only: copying and installing the project are not counted.
      record.durationMs = Date.now() - started
    }
    record.tokens = usage?.tokens ?? null
    record.costUsd = usage?.costUsd ?? null
    record.model = usage?.model ?? null
    if (usage?.error) return { ...record, reason: `agent error: ${usage.error}` }

    // The judge files are copied in only after the agent is done, so it never sees them.
    if (await exists(join(task.dir, 'judge'))) {
      await cp(join(task.dir, 'judge'), projectDir, { recursive: true, force: true })
    }
    const check = await runChecks(task.check, projectDir, checkTimeoutMs)
    return check.ok ? { ...record, pass: true } : { ...record, reason: check.reason, output: check.output }
  } finally {
    await rm(projectDir, { recursive: true, force: true, maxRetries: 3 }).catch(() => {})
  }
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
  const setups = setupIds.map((id) => {
    if (!SETUPS[id]) throw new Error(`unknown setup "${id}"; known: ${Object.keys(SETUPS).join(', ')}`)
    return SETUPS[id]
  })
  const tasks = await loadTasks(tasksDir)
  const cards = await loadCards(tasks, setups, cardsDir)
  const root = workRoot ?? (await mkdtemp(join(tmpdir(), 'drift-test-')))

  const startedAt = new Date().toISOString()
  const results = []
  for (const task of tasks) {
    for (const setup of setups) {
      const card = setup.whichlib ? cards.get(task.library) : null
      const result = await runOne({ task, setup, card, agent, workRoot: root, agentTimeoutMs, checkTimeoutMs })
      results.push(result)
      onResult(result)
    }
  }
  if (!workRoot) await rm(root, { recursive: true, force: true }).catch(() => {})

  const run = {
    startedAt,
    finishedAt: new Date().toISOString(),
    setups: setupIds,
    tasks: tasks.length,
    summary: summarize(results, setupIds),
    results,
  }
  if (outDir) {
    await mkdir(outDir, { recursive: true })
    await writeFile(join(outDir, 'results.json'), JSON.stringify(run, null, 2) + '\n')
    await writeFile(join(outDir, 'report.md'), renderReport(run))
  }
  return run
}
