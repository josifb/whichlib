import { test } from 'node:test'
import assert from 'node:assert/strict'
import { reply, type ChatMessage } from '../src/chat.js'
import { scriptedModel, textOf } from './scripted-model.js'

const SYSTEM = 'You are the support assistant for Acme. Answer in one short paragraph.'

test('sends the system prompt and the history, and returns the reply', async () => {
  const { model, prompts } = scriptedModel([{ text: 'You can reset it from the login page.' }])
  const history: ChatMessage[] = [
    { role: 'user', content: 'Hi' },
    { role: 'assistant', content: 'Hello! How can I help?' },
    { role: 'user', content: 'How do I reset my password?' },
  ]

  const answer = await reply(model, history)

  assert.equal(answer, 'You can reset it from the login page.')
  const [prompt] = prompts
  assert.deepEqual(
    prompt.map((m) => [m.role, textOf(m)]),
    [
      ['system', SYSTEM],
      ['user', 'Hi'],
      ['assistant', 'Hello! How can I help?'],
      ['user', 'How do I reset my password?'],
    ],
  )
})
