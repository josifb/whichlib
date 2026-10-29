import { z } from 'zod'

const QUANTITY = 'Quantity must be a positive whole number'

export const orderSchema = z.object({
  sku: z.string().min(1),
  quantity: z.int({ error: QUANTITY }).min(1, { error: QUANTITY }),
  coupon: z.string().optional(),
})

export type Order = z.infer<typeof orderSchema>

export function parseOrder(input: unknown) {
  const result = orderSchema.safeParse(input)
  if (result.success) return { ok: true as const, order: result.data }
  return { ok: false as const, messages: result.error.issues.map((issue) => issue.message) }
}
