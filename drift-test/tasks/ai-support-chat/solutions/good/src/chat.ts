import { generateText, type LanguageModel } from 'ai'

export type ChatMessage = { role: 'user' | 'assistant'; content: string }

const INSTRUCTIONS = 'You are the support assistant for Acme. Answer in one short paragraph.'

export async function reply(model: LanguageModel, history: ChatMessage[]): Promise<string> {
  const { text } = await generateText({ model, instructions: INSTRUCTIONS, messages: history })
  return text
}
