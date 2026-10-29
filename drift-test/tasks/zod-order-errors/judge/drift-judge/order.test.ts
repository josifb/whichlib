import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseOrder, type Order } from '../src/order.js'

const MESSAGE = 'Quantity must be a positive whole number'

function messagesOf(input: unknown): string[] {
  const result = parseOrder(input)
  assert.equal(result.ok, false)
  return (result as { messages: string[] }).messages
}

test('accepts a valid order', () => {
  const result = parseOrder({ sku: 'TSHIRT-M', quantity: 2, coupon: 'FALL10' })
  assert.equal(result.ok, true)
  const order: Order = (result as { order: Order }).order
  assert.deepEqual(order, { sku: 'TSHIRT-M', quantity: 2, coupon: 'FALL10' })
})

test('coupon is optional', () => {
  assert.equal(parseOrder({ sku: 'TSHIRT-M', quantity: 1 }).ok, true)
})

const badQuantities: Array<[string, unknown]> = [
  ['missing', undefined],
  ['not a number', 'two'],
  ['fractional', 1.5],
  ['zero', 0],
  ['negative', -3],
]
for (const [why, quantity] of badQuantities) {
  test(`quantity ${why} gives the one message`, () => {
    assert.deepEqual(messagesOf({ sku: 'TSHIRT-M', quantity }), [MESSAGE])
  })
}

test('lists every problem', () => {
  const messages = messagesOf({ sku: '', quantity: 0 })
  assert.equal(messages.length, 2)
  assert.ok(messages.includes(MESSAGE))
})
