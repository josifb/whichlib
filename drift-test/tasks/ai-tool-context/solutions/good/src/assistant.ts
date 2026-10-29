import { generateText, isStepCount, tool, type LanguageModel } from 'ai'
import { z } from 'zod'
import { ordersFor } from './orders.js'

export const listOrders = tool({
  description: "List the current customer's orders",
  inputSchema: z.object({}),
  contextSchema: z.object({ customerId: z.string() }),
  execute: async (_input, { context }) => ordersFor(context.customerId),
})

export async function askAboutOrders(model: LanguageModel, question: string, customerId: string): Promise<string> {
  const { text } = await generateText({
    model,
    prompt: question,
    tools: { listOrders },
    toolsContext: { listOrders: { customerId } },
    stopWhen: isStepCount(3),
  })
  return text
}
