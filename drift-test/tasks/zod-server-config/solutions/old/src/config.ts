import { z } from 'zod'

export const configSchema = z.object({
  host: z.string().ip(),
  port: z.number().int().min(1).max(65535).default(8080),
  allowedNetworks: z.array(z.string().cidr({ version: 'v4' })),
  features: z.record(z.boolean()),
  limits: z.record(z.number().positive()),
})

export type Config = z.infer<typeof configSchema>

export function loadConfig(raw: unknown): Config {
  return configSchema.parse(raw)
}
