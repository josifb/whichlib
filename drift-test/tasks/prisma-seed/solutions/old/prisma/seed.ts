import { prisma } from '../src/db.js'

const CATALOG = [
  { category: 'Books', product: 'The Pragmatic Programmer' },
  { category: 'Games', product: 'Chess set' },
  { category: 'Music', product: 'Kind of Blue' },
]

async function main() {
  for (const { category, product } of CATALOG) {
    const { id } = await prisma.category.upsert({ where: { name: category }, create: { name: category }, update: {} })
    await prisma.product.upsert({
      where: { name: product },
      create: { name: product, priceCents: 1000, categoryId: id },
      update: {},
    })
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
