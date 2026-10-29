// The committed task set: what the Drift Test promises about it, checked without installing anything.
// Whether each task really tells the versions apart is `npm run verify-tasks` (installs every project).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, stat } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadTasks } from '../src/runner.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const tasks = await loadTasks(join(root, 'tasks'))
const { libraries } = JSON.parse(await readFile(join(root, 'cards', 'libraries.json'), 'utf8'))
const isDir = (path) => stat(path).then((s) => s.isDirectory(), () => false)

test('three tasks for each of the ten libraries', () => {
  const perLibrary = {}
  for (const t of tasks) perLibrary[t.library] = (perLibrary[t.library] ?? 0) + 1
  assert.deepEqual(perLibrary, Object.fromEntries(libraries.map((l) => [l.package, 3])))
})

test('every task has a project, a known-good solution and an old-version solution', async () => {
  for (const t of tasks) {
    for (const part of ['project', 'solutions/good', 'solutions/old']) {
      assert.ok(await isDir(join(t.dir, part)), `${t.id} has no ${part}/`)
    }
  }
})

// The agent must find out on its own which version is installed and what changed.
const VERSION_NUMBERS = [/\bv?\d+\.\d+/i, /\bv\d+\b/i]
// Checked on the prose only: code in backticks such as `new Date()` is not a hint.
const GIVEAWAY_WORDS = /\b(version|latest|newest|modern|recent|current|new|old|legacy|outdated|deprecated|breaking|migrat\w*|upgrad\w*)\b/i

test('task prompts never mention a version or a change between versions', () => {
  for (const t of tasks) {
    // IPv4 addresses and ranges such as 10.0.0.0/8 are data, not versions.
    const text = t.prompt.replace(/\b\d{1,3}(\.\d{1,3}){3}(\/\d+)?/g, '')
    for (const pattern of VERSION_NUMBERS) assert.doesNotMatch(text, pattern, `${t.id}: prompt matches ${pattern}`)
    const prose = t.prompt.replace(/`[^`]*`/g, '')
    assert.doesNotMatch(prose, GIVEAWAY_WORDS, `${t.id}: prompt hints at a change between versions`)
  }
})

test('every task installs the version its library card was built for', async () => {
  for (const t of tasks) {
    const { ecosystem, to } = libraries.find((l) => l.package === t.library)
    assert.equal(await lockedVersion(t, ecosystem), to, `${t.id} does not lock ${t.library} ${to}`)
  }
})

async function lockedVersion(task, ecosystem) {
  if (ecosystem === 'npm') {
    const lock = JSON.parse(await readFile(join(task.dir, 'project', 'package-lock.json'), 'utf8'))
    return lock.packages[`node_modules/${task.library}`]?.version
  }
  const lock = await readFile(join(task.dir, 'project', 'uv.lock'), 'utf8')
  return lock.match(new RegExp(`\\[\\[package\\]\\]\\r?\\nname = "${task.library}"\\r?\\nversion = "([^"]+)"`))?.[1]
}
