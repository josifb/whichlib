import { test } from 'node:test'
import assert from 'node:assert/strict'
import { claudeArgs, CONTEXT7_RULE } from '../src/claude-code.mjs'
import { SETUPS } from '../src/runner.mjs'

// What the agent finds appended to its system prompt under a setup, or null.
function appended(setupId, card = '# card for mathlib') {
  const args = claudeArgs({ setup: SETUPS[setupId], card, mcpConfigPath: 'mcp.json' })
  const i = args.indexOf('--append-system-prompt')
  return i === -1 ? null : args[i + 1]
}

test("Context7's own recommended rule goes to the context7 and both setups only", () => {
  assert.equal(
    CONTEXT7_RULE,
    'Always use Context7 when I need library/API documentation, code generation, setup or configuration steps without me having to explicitly ask.',
  )
  assert.equal(appended('alone'), null)
  assert.equal(appended('context7'), CONTEXT7_RULE)
  assert.equal(appended('whichlib'), '# card for mathlib')
  assert.equal(appended('both'), `${CONTEXT7_RULE}\n\n# card for mathlib`)
})
