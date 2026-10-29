import { cookies } from 'next/headers'

export async function currentTheme(): Promise<'light' | 'dark'> {
  const store = await cookies()
  return store.get('theme')?.value === 'dark' ? 'dark' : 'light'
}
