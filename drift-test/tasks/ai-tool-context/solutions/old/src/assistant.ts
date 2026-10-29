import { generateText, stepCountIs, tool, type LanguageModel } from 'ai'
import { z } from 'zod'
import { ordersFor } from './orders.js'

export const listOrders = tool({
  description: "List the current customer's orders",
  inputSchema: z.object({}),
  execute: async (_input, { experimental_context }) => {
    const { customerId } = experimental_context as { customerId: string }
    return ordersFor(customerId)
  },
})

export async function askAboutOrders(model: LanguageModel, question: string, customerId: string): Promise<string> {
  const { text } = await generateText({
    model,
    prompt: question,
    tools: { listOrders },
    experimental_context: { customerId },
    stopWhen: stepCountIs(3),
  })
  return text
}
