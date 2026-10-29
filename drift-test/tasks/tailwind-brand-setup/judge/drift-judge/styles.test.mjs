import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const css = readFileSync('dist/styles.css', 'utf8')

test('the utilities used in index.html are generated', () => {
  for (const selector of ['.p-4', '.rounded-xl', '.text-2xl', '.font-bold', '.md\\:flex', '.bg-white', '.text-white']) {
    assert.ok(css.includes(selector), `missing ${selector}`)
  }
})

test('the brand color works like a built-in color', () => {
  assert.ok(css.includes('.bg-brand'), 'missing .bg-brand')
  assert.ok(css.includes('.text-brand'), 'missing .text-brand')
  assert.match(css, /#1d4ed8/i)
})

test('no unprocessed Tailwind directives are left', () => {
  assert.doesNotMatch(css, /@tailwind\b/)
})
