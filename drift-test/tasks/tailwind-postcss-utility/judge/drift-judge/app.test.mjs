import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const css = readFileSync('dist/app.css', 'utf8')

test('the utilities used in index.html are generated', () => {
  for (const selector of ['.p-6', '.rounded-lg', '.shadow', '.max-w-2xl', '.bg-gray-50']) {
    assert.ok(css.includes(selector), `missing ${selector}`)
  }
  assert.doesNotMatch(css, /@tailwind\b/)
})

test('content-auto is a utility that works with variants', () => {
  assert.match(css, /content-visibility:\s*auto/)
  assert.ok(css.includes('.content-auto'), 'missing .content-auto')
  assert.ok(css.includes('.lg\\:content-auto'), 'missing .lg:content-auto')
  assert.ok(css.includes('.hover\\:content-auto:hover'), 'missing .hover:content-auto')
})
