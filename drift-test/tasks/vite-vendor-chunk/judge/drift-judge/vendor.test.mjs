import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'

const assets = readdirSync('dist/assets').filter((f) => f.endsWith('.js'))
const read = (f) => readFileSync(`dist/assets/${f}`, 'utf8')
// Present in the production build of react-dom, in no application code.
const REACT = 'react.dev/errors'

test('react and react-dom are in one vendor chunk', () => {
  const vendor = assets.filter((f) => /^vendor-[\w-]+\.js$/.test(f))
  assert.equal(vendor.length, 1, `expected one vendor-<hash>.js, got ${assets.join(', ')}`)
  assert.ok(read(vendor[0]).includes(REACT), 'the vendor chunk holds react-dom')
  assert.ok(!read(vendor[0]).includes('Shop ready'), 'application code is not in the vendor chunk')
})

test('the entry chunk holds the app and loads the vendor chunk, without bundling react itself', () => {
  const html = readFileSync('dist/index.html', 'utf8')
  const entry = html.match(/src="\/assets\/([^"]+\.js)"/)?.[1]
  assert.ok(entry, 'index.html loads an entry script')
  const code = read(entry)
  assert.ok(code.includes('Shop ready'))
  assert.ok(!code.includes(REACT))
  assert.match(code + html, /vendor-[\w-]+\.js/)
})
