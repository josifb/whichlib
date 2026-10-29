import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../src/db.js'
import { publishedTitlesBy, publishPost } from '../src/blog.js'

after(() => prisma.$disconnect())

test('lists an author\'s published posts, newest first', async () => {
  const ada = await prisma.user.create({ data: { email: 'ada@example.com', name: 'Ada' } })
  const bob = await prisma.user.create({ data: { email: 'bob@example.com', name: 'Bob' } })
  const day = (d: number) => new Date(Date.UTC(2026, 9, d))
  await prisma.post.createMany({
    data: [
      { title: 'Old news', publishedAt: day(1), authorId: ada.id },
      { title: 'Fresh take', publishedAt: day(20), authorId: ada.id },
      { title: 'Draft', publishedAt: null, authorId: ada.id },
      { title: "Bob's post", publishedAt: day(10), authorId: bob.id },
    ],
  })

  assert.deepEqual(await publishedTitlesBy('ada@example.com'), ['Fresh take', 'Old news'])

  const draft = await prisma.post.findFirstOrThrow({ where: { title: 'Draft' } })
  await publishPost(draft.id)
  assert.deepEqual(await publishedTitlesBy('ada@example.com'), ['Draft', 'Fresh take', 'Old news'])
  assert.deepEqual(await publishedTitlesBy('nobody@example.com'), [])
})
