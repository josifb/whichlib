import { window } from './dom.js'
import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { Stopwatch } from '../src/Stopwatch.js'

// The hook may call setInterval or window.setInterval; both are driven by the mocked clock.
mock.timers.enable({ apis: ['setInterval'] })
window.setInterval = setInterval as any
window.clearInterval = clearInterval as any

const button = (container: Element, label: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent === label)!
const click = (el: Element) => act(async () => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true })))
const tick = (ms: number) => act(async () => mock.timers.tick(ms))

test('counts seconds while running, pauses on stop, and resets to zero', async () => {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => root.render(<Stopwatch />))
  const time = () => container.querySelector('[data-testid="time"]')!.textContent

  assert.equal(time(), '0s')
  await click(button(container, 'Start'))
  await tick(3000)
  assert.equal(time(), '3s')

  await click(button(container, 'Stop'))
  await tick(5000)
  assert.equal(time(), '3s')

  await click(button(container, 'Start'))
  await tick(1000)
  assert.equal(time(), '4s')

  await click(button(container, 'Reset'))
  assert.equal(time(), '0s')
  await tick(2000)
  assert.equal(time(), '0s', 'reset stops the clock')
  await act(async () => root.unmount())
})
