import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

const PRODUCTS = [
  ['lamp', 'Desk lamp', '39.00 EUR'],
  ['chair', 'Office chair', '189.00 EUR'],
  ['mug', 'Coffee mug', '12.00 EUR'],
]

// React may put comment markers between text pieces; drop them before comparing.
const page = (id) => readFileSync(`.next/server/app/products/${id}.html`, 'utf8').replaceAll('<!-- -->', '')

for (const [id, name, price] of PRODUCTS) {
  test(`/products/${id} is prerendered with its name, price and title`, () => {
    assert.ok(existsSync(`.next/server/app/products/${id}.html`), `no prerendered page for ${id}`)
    const html = page(id)
    assert.match(html, new RegExp(`<h1[^>]*>${name}</h1>`))
    assert.ok(html.includes(price), `price ${price} is shown`)
    assert.match(html, new RegExp(`<title>${name} \\| Shop</title>`))
  })
}
