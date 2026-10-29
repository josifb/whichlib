import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { addTodo, completeTodo, disconnect, listTodos } from '../src/todos.js'

after(() => disconnect())

test('adds, lists and completes todos in dev.db', async () => {
  const milk = await addTodo('Buy milk')
  const bread = await addTodo('Bake bread')
  assert.equal(milk.done, false)
  assert.ok(milk.createdAt instanceof Date)

  await completeTodo(milk.id)

  const todos = await listTodos()
  assert.deepEqual(
    todos.map((t) => [t.id, t.title, t.done]),
    [
      [milk.id, 'Buy milk', true],
      [bread.id, 'Bake bread', false],
    ],
  )
  assert.ok(existsSync('dev.db'), 'the database is the dev.db file at the project root')
})
