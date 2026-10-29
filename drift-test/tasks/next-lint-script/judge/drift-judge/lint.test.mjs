import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { rmSync, writeFileSync } from 'node:fs'

// A synchronous third-party script is an error under the Next.js core web vitals rules.
const BAD_FILE = 'app/bad-script.tsx'

test('npm run lint fails on a Next.js rule violation', () => {
  writeFileSync(BAD_FILE, 'export default function Bad() {\n  return <script src="https://example.com/widget.js" />\n}\n')
  try {
    const run = spawnSync('npm run lint', { shell: true, encoding: 'utf8' })
    assert.notEqual(run.status, 0, 'lint must exit non-zero')
    assert.match(run.stdout + run.stderr, /no-sync-scripts/)
  } finally {
    rmSync(BAD_FILE, { force: true })
  }
})
