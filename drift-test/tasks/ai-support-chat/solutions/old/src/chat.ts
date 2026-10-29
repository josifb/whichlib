import { generateText, type LanguageModel, type ModelMessage } from 'ai'

export type ChatMessage = { role: 'user' | 'assistant'; content: string }

const SYSTEM = 'You are the support assistant for Acme. Answer in one short paragraph.'

export async function reply(model: LanguageModel, history: ChatMessage[]): Promise<string> {
  const messages: ModelMessage[] = [{ role: 'system', content: SYSTEM }, ...history]
  const { text } = await generateText({ model, messages })
  return text
}
