import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const css = readFileSync('dist/styles.css', 'utf8')

// The selector of the rule generated for a dark: utility, without the utility's own class name.
function darkSelector(className) {
  const escaped = className.replace(':', '\\\\:')
  const match = css.match(new RegExp(`\\.${escaped}([^{]*)\\{`))
  assert.ok(match, `no rule for .${className}`)
  return match[1]
}

test('dark: utilities apply under the dark class', () => {
  for (const className of ['dark:bg-gray-900', 'dark:text-gray-100', 'dark:border-gray-600']) {
    assert.match(darkSelector(className), /\.dark\b/, `${className} does not depend on the .dark class`)
  }
})

test('dark: utilities no longer follow the operating system setting', () => {
  assert.doesNotMatch(css, /prefers-color-scheme:\s*dark/)
})

test('the other utilities are still built', () => {
  assert.ok(css.includes('.bg-white'))
  assert.ok(css.includes('.p-8'))
})
