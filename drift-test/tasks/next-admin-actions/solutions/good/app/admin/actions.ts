'use server'

import { cookies } from 'next/headers'
import { updateTag } from 'next/cache'

export async function refreshProducts() {
  updateTag('products')
}

export async function setTheme(theme: 'light' | 'dark') {
  const store = await cookies()
  store.set('theme', theme, { maxAge: 60 * 60 * 24 * 365, path: '/' })
}
