import { test } from 'node:test'
import assert from 'node:assert/strict'
import { askAboutOrders } from '../src/assistant.js'
import { scriptedModel, textOf } from './scripted-model.js'

async function ask(customerId: string) {
  const { model, prompts } = scriptedModel([{ toolCall: { name: 'listOrders', input: {} } }, { text: 'Here are your orders.' }])
  const answer = await askAboutOrders(model, 'Where are my orders?', customerId)
  assert.equal(answer, 'Here are your orders.')
  assert.equal(prompts.length, 2)
  const toolResults = prompts[1].filter((m) => m.role === 'tool').map(textOf).join('\n')
  return toolResults
}

test('the tool sees the orders of the customer passed in, and only those', async () => {
  const first = await ask('cus-1')
  assert.match(first, /A-100/)
  assert.match(first, /A-101/)
  assert.doesNotMatch(first, /B-200/)

  const second = await ask('cus-2')
  assert.match(second, /B-200/)
  assert.doesNotMatch(second, /A-10/)
})

