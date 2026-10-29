import { window } from './dom.js'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { ChapterList } from '../src/ChapterList.js'

const chapters = [
  { id: 'a', title: 'Arrival' },
  { id: 'b', title: 'Bargain' },
  { id: 'c', title: 'Crossing' },
]

const scrolled: Array<{ id: string | null; options: unknown }> = []
window.Element.prototype.scrollIntoView = function (this: Element, options?: unknown) {
  scrolled.push({ id: this.getAttribute('data-id'), options })
}

test('renders one item per chapter and scrolls the selected one into view', async () => {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)

  await act(async () => root.render(<ChapterList chapters={chapters} selectedId="b" />))
  const items = [...container.querySelectorAll('li')].map((li) => [li.getAttribute('data-id'), li.textContent])
  assert.deepEqual(items, [['a', 'Arrival'], ['b', 'Bargain'], ['c', 'Crossing']])
  assert.deepEqual(scrolled.at(-1), { id: 'b', options: { block: 'nearest' } })

  await act(async () => root.render(<ChapterList chapters={chapters} selectedId="c" />))
  assert.deepEqual(scrolled.at(-1), { id: 'c', options: { block: 'nearest' } })

  const count = scrolled.length
  await act(async () => root.render(<ChapterList chapters={chapters} />))
  assert.equal(scrolled.length, count, 'no scroll without a selection')
  await act(async () => root.unmount())
})
