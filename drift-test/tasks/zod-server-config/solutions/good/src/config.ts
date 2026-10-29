import { z } from 'zod'

export const configSchema = z.object({
  host: z.union([z.ipv4(), z.ipv6()]),
  port: z.int().min(1).max(65535).default(8080),
  allowedNetworks: z.array(z.cidrv4()),
  features: z.record(z.string(), z.boolean()),
  limits: z.record(z.string(), z.number().positive()),
})

export type Config = z.infer<typeof configSchema>

export function loadConfig(raw: unknown): Config {
  return configSchema.parse(raw)
}
