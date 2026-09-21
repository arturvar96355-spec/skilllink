import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@/generated/prisma/client'

/**
 * Единственная точка создания клиента Prisma.
 * Prisma 7 работает через драйверный адаптер, строка подключения берётся из DATABASE_URL.
 * В dev-режиме Next перезагружает модули, поэтому клиент кладётся в globalThis —
 * иначе на каждый hot reload открывается новый пул соединений.
 */
const createClient = (): PrismaClient => {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error('Не задана переменная окружения DATABASE_URL')
  }
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) })
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

export const prisma: PrismaClient = globalForPrisma.prisma ?? createClient()

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}
