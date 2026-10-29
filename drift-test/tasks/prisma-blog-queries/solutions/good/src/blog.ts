import { prisma } from './db.js'

export function publishPost(id: number) {
  return prisma.post.update({ where: { id }, data: { publishedAt: new Date() } })
}

export async function publishedTitlesBy(email: string): Promise<string[]> {
  const posts = await prisma.post.findMany({
    where: { author: { email }, publishedAt: { not: null } },
    orderBy: { publishedAt: 'desc' },
    select: { title: true },
  })
  return posts.map((p) => p.title)
}
