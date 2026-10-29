import { generateText, stepCountIs, tool, type LanguageModel } from 'ai'
import { z } from 'zod'

const getTime = tool({
  description: 'The current time',
  inputSchema: z.object({}),
  execute: async () => ({ iso: new Date().toISOString() }),
})

export async function answerWithUsage(model: LanguageModel, question: string) {
  const result = await generateText({
    model,
    prompt: question,
    tools: { getTime },
    stopWhen: stepCountIs(3),
  })
  const usage = result.totalUsage
  return {
    text: result.text,
    steps: result.steps.length,
    inputTokens: usage.inputTokens ?? 0,
    cachedInputTokens: usage.cachedInputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
    reasoningTokens: usage.reasoningTokens ?? 0,
  }
}
