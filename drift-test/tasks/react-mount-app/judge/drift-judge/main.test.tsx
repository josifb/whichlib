import { window } from './dom.js'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { act } from 'react'
import { renderToString } from 'react-dom/server'
import { App } from '../src/App.js'
import { hydrateApp, mountApp } from '../src/main.js'

const click = (el: Element) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))

test('mounts the app, keeps it interactive, and unmounts it', async () => {
  const container = document.createElement('div')
  document.body.append(container)

  let unmount!: () => void
  await act(async () => {
    unmount = mountApp(container)
  })
  assert.match(container.textContent ?? '', /Hello from the widget/)
  await act(async () => click(container.querySelector('button')!))
  assert.match(container.textContent ?? '', /Clicked 1 times/)

  await act(async () => unmount())
  assert.equal(container.innerHTML, '')
})

test('hydrates server HTML without replacing it', async () => {
  const container = document.createElement('div')
  container.innerHTML = renderToString(<App />)
  document.body.append(container)
  const serverHeading = container.querySelector('h1')

  let unmount!: () => void
  await act(async () => {
    unmount = hydrateApp(container)
  })
  assert.equal(container.querySelector('h1'), serverHeading, 'the server-rendered nodes are kept')
  await act(async () => click(container.querySelector('button')!))
  assert.match(container.textContent ?? '', /Clicked 1 times/)

  await act(async () => unmount())
  assert.equal(container.innerHTML, '')
})
