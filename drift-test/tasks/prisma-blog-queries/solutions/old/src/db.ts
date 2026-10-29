import { PrismaClient } from '@prisma/client'

export const prisma = new PrismaClient({ datasourceUrl: 'file:./dev.db' })
