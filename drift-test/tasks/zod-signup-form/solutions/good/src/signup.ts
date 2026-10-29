import { z } from 'zod'

export const signupSchema = z.object({
  email: z
    .string({ error: (issue) => (issue.input === undefined ? 'Email is required' : 'Email must be text') })
    .pipe(z.email({ error: 'Enter a valid email' })),
  password: z.string().min(8, { error: 'Password must be at least 8 characters' }),
  age: z.int().min(13).optional(),
})

export type Signup = z.infer<typeof signupSchema>

export function validateSignup(input: unknown) {
  const result = signupSchema.safeParse(input)
  if (result.success) return { success: true as const, data: result.data }
  const errors: Record<string, string> = {}
  for (const issue of result.error.issues) errors[issue.path.join('.')] ??= issue.message
  return { success: false as const, errors }
}
