import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifyTasks } from '../src/verify-tasks.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const tasksDir = join(here, 'fixtures', 'tasks')

test('a task is verified when its good solution passes and its old solution fails', async () => {
  const run = await verifyTasks({ tasksDir })

  assert.equal(run.ok, true)
  assert.deepEqual(
    run.tasks.map((t) => [t.task, t.good.outcome, t.old.outcome, t.ok]),
    [
      ['add', 'pass', 'fail', true],
      ['greet', 'pass', 'fail', true],
    ],
  )
})

test('names the task whose old solution passes its check', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'drift-verify-'))
  await cp(tasksDir, dir, { recursive: true })
  // An old solution that is in fact still right: the task cannot tell the versions apart.
  await writeFile(join(dir, 'greet', 'solutions', 'old', 'greet.mjs'), 'export const greet = (name) => `Hello, ${name}!`\n')

  const run = await verifyTasks({ tasksDir: dir })

  assert.equal(run.ok, false)
  const greet = run.tasks.find((t) => t.task === 'greet')
  assert.equal(greet.ok, false)
  assert.equal(greet.old.outcome, 'pass')
  assert.equal(run.tasks.find((t) => t.task === 'add').ok, true)
})

test('an old solution that ends in an error does not verify the task', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'drift-verify-'))
  await cp(tasksDir, dir, { recursive: true })
  // No old solution to write: the fake agent fails before touching the project.
  await rm(join(dir, 'greet', 'solutions', 'old'), { recursive: true })

  const run = await verifyTasks({ tasksDir: dir, only: ['greet'] })

  assert.equal(run.ok, false)
  assert.equal(run.tasks[0].old.outcome, 'error')
})

test('refuses a task or library name it does not know', async () => {
  await assert.rejects(verifyTasks({ tasksDir, only: ['nope'] }), /no task or library named nope/)
})

test('only checks the tasks it is asked for', async () => {
  const run = await verifyTasks({ tasksDir, only: ['greet'] })

  assert.deepEqual(run.tasks.map((t) => t.task), ['greet'])
})
