import { cookies } from 'next/headers'

export async function currentTheme(): Promise<'light' | 'dark'> {
  return cookies().get('theme')?.value === 'dark' ? 'dark' : 'light'
}
