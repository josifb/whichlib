import { generateText, isStepCount, tool, type LanguageModel } from 'ai'
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
    stopWhen: isStepCount(3),
  })
  const { usage } = result // all steps
  return {
    text: result.text,
    steps: result.steps.length,
    inputTokens: usage.inputTokens ?? 0,
    cachedInputTokens: usage.inputTokenDetails.cacheReadTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
    reasoningTokens: usage.outputTokenDetails.reasoningTokens ?? 0,
  }
}
