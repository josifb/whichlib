// Runs the Server Actions outside Next.js, with next/cache and next/headers replaced by recorders.
import { mock, test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

// Every next/cache function records its call, whichever one the code uses to invalidate.
const cacheCalls: Array<{ fn: string; args: unknown[] }> = []
const realCache = await import('next/cache')
mock.module('next/cache', {
  namedExports: Object.fromEntries(
    Object.keys(realCache).map((fn) => [fn, (...args: unknown[]) => void cacheCalls.push({ fn, args })]),
  ),
})

// A cookie store like the one next/headers hands out during a request.
const jar = new Map<string, { value: string; options: Record<string, unknown> }>()
const store = {
  get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)!.value } : undefined),
  set: (...args: any[]) => {
    const [name, value, options] = typeof args[0] === 'string' ? args : [args[0].name, args[0].value, args[0]]
    jar.set(name, { value, options: options ?? {} })
  },
  has: (name: string) => jar.has(name),
  delete: (name: string) => jar.delete(name),
}
mock.module('next/headers', { namedExports: { cookies: async () => store, headers: async () => new Headers() } })

const { refreshProducts, setTheme } = await import('../app/admin/actions.js')
const { currentTheme } = await import('../lib/theme.js')

beforeEach(() => {
  cacheCalls.length = 0
  jar.clear()
})

test('refreshProducts invalidates the products tag', async () => {
  await refreshProducts()
  assert.ok(
    cacheCalls.some((c) => c.args[0] === 'products'),
    `expected a next/cache call for 'products', got ${JSON.stringify(cacheCalls)}`,
  )
})

test('setTheme stores the theme cookie for one year', async () => {
  await setTheme('dark')
  const cookie = jar.get('theme')
  assert.equal(cookie?.value, 'dark')
  const year = 365 * 24 * 60 * 60
  const { maxAge, expires } = cookie!.options as { maxAge?: number; expires?: Date | number }
  const seconds = maxAge ?? (expires ? (new Date(expires).getTime() - Date.now()) / 1000 : 0)
  assert.ok(Math.abs(seconds - year) < 2 * 24 * 60 * 60, `cookie lasts ${seconds} s, expected about a year`)
})

test('currentTheme reads the cookie and defaults to light', async () => {
  assert.equal(await currentTheme(), 'light')
  await setTheme('dark')
  assert.equal(await currentTheme(), 'dark')
  await setTheme('light')
  assert.equal(await currentTheme(), 'light')
})
