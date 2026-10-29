import { z } from 'zod'

const QUANTITY = 'Quantity must be a positive whole number'

export const orderSchema = z.object({
  sku: z.string().min(1),
  quantity: z.number({ errorMap: () => ({ message: QUANTITY }) }).int().positive(),
  coupon: z.string().optional(),
})

export type Order = z.infer<typeof orderSchema>

export function parseOrder(input: unknown) {
  const result = orderSchema.safeParse(input)
  if (result.success) return { ok: true as const, order: result.data }
  return { ok: false as const, messages: result.error.errors.map((error) => error.message) }
}
