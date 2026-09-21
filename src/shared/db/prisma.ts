import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@/generated/prisma/client'

/**
 * Единственная точка создания клиента Prisma.
 * Prisma 7 работает через драйверный адаптер, строка подключения берётся из DATABASE_URL.
 */
const createClient = (): PrismaClient => {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error('Не задана переменная окружения DATABASE_URL')
  }
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) })
}

/**
 * В dev-режиме Next перезагружает модули, поэтому клиент кладётся в globalThis —
 * иначе на каждый hot reload открывается новый пул соединений.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

function getClient(): PrismaClient {
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = createClient()
  }
  return globalForPrisma.prisma
}

/**
 * Клиент создаётся при первом обращении, а не при импорте модуля.
 *
 * Иначе любой файл, который хоть как-то связан с базой, падал бы уже на импорте
 * без DATABASE_URL — и юнит-тест чистой функции из соседнего модуля требовал бы
 * поднятой базы. Прокси убирает эту связанность, поведение для вызывающего кода
 * не меняется.
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const instance = getClient()
    const value = Reflect.get(instance, property) as unknown
    // Методы привязываются к экземпляру: иначе `this` внутри клиента укажет на прокси.
    return typeof value === 'function' ? value.bind(instance) : value
  },
})
