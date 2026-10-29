import { test } from 'node:test'
import assert from 'node:assert/strict'
import { answerWithUsage } from '../src/usage.js'
import { scriptedModel } from './scripted-model.js'

test('adds up token usage over every step, cache and reasoning included', async () => {
  const { model, prompts } = scriptedModel([
    { toolCall: { name: 'getTime', input: {} }, usage: { input: 100, cacheRead: 80, output: 20, reasoning: 12 } },
    { text: 'It is noon.', usage: { input: 150, cacheRead: 100, output: 30, reasoning: 5 } },
  ])

  const result = await answerWithUsage(model, 'What time is it?')

  assert.equal(prompts.length, 2, 'the tool result goes back to the model')
  assert.deepEqual(result, {
    text: 'It is noon.',
    steps: 2,
    inputTokens: 250,
    cachedInputTokens: 180,
    outputTokens: 50,
    reasoningTokens: 17,
  })
})

test('missing numbers count as 0', async () => {
  const { model } = scriptedModel([{ text: 'Hello.', usage: { input: 7, output: 3 } }])

  const result = await answerWithUsage(model, 'Hi')

  assert.deepEqual(result, { text: 'Hello.', steps: 1, inputTokens: 7, cachedInputTokens: 0, outputTokens: 3, reasoningTokens: 0 })
})
