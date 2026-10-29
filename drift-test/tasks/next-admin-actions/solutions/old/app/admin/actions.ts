'use server'

import { cookies } from 'next/headers'
import { revalidateTag } from 'next/cache'

export async function refreshProducts() {
  revalidateTag('products')
}

export async function setTheme(theme: 'light' | 'dark') {
  cookies().set('theme', theme, { maxAge: 60 * 60 * 24 * 365, path: '/' })
}
