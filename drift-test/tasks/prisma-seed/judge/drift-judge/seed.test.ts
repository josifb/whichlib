import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../src/db.js'

after(() => prisma.$disconnect())

test('the seed (run twice) leaves three categories with one product each', async () => {
  const categories = await prisma.category.findMany({ include: { products: true }, orderBy: { name: 'asc' } })
  assert.deepEqual(
    categories.map((c) => c.name),
    ['Books', 'Games', 'Music'],
  )
  for (const category of categories) {
    assert.equal(category.products.length, 1, `${category.name} has one product`)
    assert.equal(category.products[0].priceCents, 1000)
  }
  assert.equal(await prisma.product.count(), 3)
})
