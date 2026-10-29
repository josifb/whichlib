// A language model for tests: answers each call with the next scripted step and records every prompt.
import { MockLanguageModelV4 } from 'ai/test'

type Step =
  | { text: string; usage?: Usage }
  | { toolCall: { name: string; input: unknown }; usage?: Usage }
type Usage = { input: number; cacheRead?: number; output: number; reasoning?: number }

export function scriptedModel(steps: Step[]) {
  const prompts: any[][] = []
  let call = 0
  const model = new MockLanguageModelV4({
    doGenerate: async (options: any) => {
      prompts.push(options.prompt)
      const step = steps[call++]
      if (!step) throw new Error(`the model was called ${call} times, but only ${steps.length} replies are scripted`)
      const usage = step.usage ?? { input: 10, output: 5 }
      return {
        content:
          'text' in step
            ? [{ type: 'text' as const, text: step.text }]
            : [
                {
                  type: 'tool-call' as const,
                  toolCallId: `call-${call}`,
                  toolName: step.toolCall.name,
                  input: JSON.stringify(step.toolCall.input),
                },
              ],
        finishReason: { unified: 'text' in step ? ('stop' as const) : ('tool-calls' as const), raw: undefined },
        usage: {
          inputTokens: {
            total: usage.input,
            noCache: usage.input - (usage.cacheRead ?? 0),
            cacheRead: usage.cacheRead,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: usage.output,
            text: usage.output - (usage.reasoning ?? 0),
            reasoning: usage.reasoning,
          },
        },
        warnings: [],
      }
    },
  })
  return { model, prompts }
}

// The text of every part of a prompt message, joined; system messages carry plain strings.
export function textOf(message: any): string {
  if (typeof message.content === 'string') return message.content
  return message.content
    .map((part: any) => part.text ?? (part.output !== undefined ? JSON.stringify(part.output) : ''))
    .join('')
}
