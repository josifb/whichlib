import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

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
