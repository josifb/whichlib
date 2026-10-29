import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaClient } from './generated/prisma/client.js'

const prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: 'file:./dev.db' }) })

export function addTodo(title: string) {
  return prisma.todo.create({ data: { title } })
}

export function listTodos() {
  return prisma.todo.findMany({ orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] })
}

export function completeTodo(id: number) {
  return prisma.todo.update({ where: { id }, data: { done: true } })
}

export function disconnect() {
  return prisma.$disconnect()
}
