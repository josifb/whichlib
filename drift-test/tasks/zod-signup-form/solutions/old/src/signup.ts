import { z } from 'zod'

export const signupSchema = z.object({
  email: z
    .string({ required_error: 'Email is required', invalid_type_error: 'Email must be text' })
    .email({ message: 'Enter a valid email' }),
  password: z.string().min(8, { message: 'Password must be at least 8 characters' }),
  age: z.number().int().min(13).optional(),
})

export type Signup = z.infer<typeof signupSchema>

export function validateSignup(input: unknown) {
  const result = signupSchema.safeParse(input)
  if (result.success) return { success: true as const, data: result.data }
  const errors: Record<string, string> = {}
  for (const error of result.error.errors) errors[error.path.join('.')] ??= error.message
  return { success: false as const, errors }
}
