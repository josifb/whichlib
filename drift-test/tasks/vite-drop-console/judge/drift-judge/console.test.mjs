import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'

const code = readdirSync('dist/assets')
  .filter((f) => f.endsWith('.js'))
  .map((f) => readFileSync(`dist/assets/${f}`, 'utf8'))
  .join('\n')

test('the app is still built', () => {
  assert.match(code, /Total: /)
  assert.match(code, /EUR/)
})

test('no console calls or debugger statements are left', () => {
  assert.doesNotMatch(code, /\[checkout\]|\[cart\]/, 'log messages are gone')
  assert.doesNotMatch(code, /\bconsole\s*\.\s*\w+\s*\(/)
  assert.doesNotMatch(code, /\bdebugger\b/)
})
