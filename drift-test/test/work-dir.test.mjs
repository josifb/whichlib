import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defaultWorkDir, prepareWorkDir } from '../src/work-dir.mjs'

for (const file of ['CLAUDE.md', 'CLAUDE.local.md', join('.claude', 'CLAUDE.md')]) {
  test(`refuses a work folder below a parent that holds ${file}, and names the file`, async () => {
    const base = await mkdtemp(join(tmpdir(), 'drift-work-'))
    await mkdir(join(base, 'parent', '.claude'), { recursive: true })
    await writeFile(join(base, 'parent', file), 'Always use TypeSafe.\n')

    const work = join(base, 'parent', 'child', 'work')
    await assert.rejects(prepareWorkDir(work), (err) => {
      assert.ok(err.message.includes(join(base, 'parent', file)), err.message)
      return true
    })
  })
}

test('accepts a work folder with no CLAUDE.md in it or any parent, and creates it', async () => {
  // The work folder is checked against every parent, so the base must be clean: a folder on a temp
  // root works on CI, but on a PC whose temp folder sits below ~/.claude/CLAUDE.md nothing under it is clean.
  const work = join(defaultWorkDir(), `test-${process.pid}`)
  const created = await prepareWorkDir(work).catch((err) => err)
  if (created instanceof Error) {
    assert.match(created.message, /CLAUDE\.md/)
    return
  }
  assert.equal(created, work)
  assert.ok((await stat(work)).isDirectory())
  await rm(work, { recursive: true, force: true })
})

test('the default work folder is outside the user folder when the temp folder is inside it', () => {
  const windows = { platform: 'win32', home: 'C:\\Users\\josif', tmp: 'C:\\Users\\josif\\AppData\\Local\\Temp' }
  assert.equal(defaultWorkDir(windows), 'C:\\drift-work')
  assert.equal(defaultWorkDir({ platform: 'linux', home: '/home/josif', tmp: '/tmp' }), '/tmp/drift-work')
  assert.equal(defaultWorkDir({ platform: 'darwin', home: '/Users/josif', tmp: '/Users/josif/tmp' }), '/drift-work')
})
