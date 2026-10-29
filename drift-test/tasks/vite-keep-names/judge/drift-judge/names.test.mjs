import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const file = 'dist/payments.js'
const lib = await import(pathToFileURL(file).href)

test('classes and functions keep their names', async () => {
  assert.equal(new lib.PaymentError('x').name, 'PaymentError')
  assert.equal(lib.chargeCard.name, 'chargeCard')
  const declined = await lib.chargeCard({ number: '4000000000000002' }, 500).catch((err) => err)
  assert.equal(declined.name, 'CardDeclinedError')
  assert.equal(declined.code, 'card_declined')
})

test('the library still works and is still minified', async () => {
  assert.deepEqual(await lib.chargeCard({ number: '4242424242424242' }, 1250), { id: 'ch_4242_1250', amount: 1250 })
  const code = readFileSync(file, 'utf8')
  assert.ok(!code.includes('\n  '), 'no indented source lines')
})
