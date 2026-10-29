import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaClient } from './generated/prisma/client.js'

export const prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: 'file:./dev.db' }) })
