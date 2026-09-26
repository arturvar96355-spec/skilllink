import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'
import { PrismaClient } from '@/generated/prisma/client'

/**
 * Единственная точка создания клиента Prisma.
 * Prisma 7 работает через драйверный адаптер, строка подключения берётся из DATABASE_URL.
 *
 * Пул соединений (`pg.Pool`) создаётся здесь явно, а не строкой подключения —
 * только так к нему остаётся доступ снаружи адаптера: метрики `db_pool_*`
 * (решение 137) читают его счётчики `totalCount`/`idleCount`/`waitingCount`.
 * Поведению адаптера это не мешает: `PrismaPg` принимает готовый `pg.Pool` наравне
 * со строкой подключения.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient; pgPool?: Pool }

const createClient = (): PrismaClient => {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error('Не задана переменная окружения DATABASE_URL')
  }
  const pool = new Pool({ connectionString })
  globalForPrisma.pgPool = pool
  return new PrismaClient({ adapter: new PrismaPg(pool) })
}

/**
 * В dev-режиме Next перезагружает модули, поэтому клиент кладётся в globalThis —
 * иначе на каждый hot reload открывается новый пул соединений.
 */
function getClient(): PrismaClient {
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = createClient()
  }
  return globalForPrisma.prisma
}

/**
 * Счётчики пула соединений — только для метрик (решение 137). `null`, пока клиент
 * не создан: значит, ни один запрос к базе ещё не понадобился (сборщик метрик
 * его создаёт сам обращением к `prisma`, а не проверяет заранее).
 */
export function poolStats(): { total: number; idle: number; waiting: number } | null {
  const pool = globalForPrisma.pgPool
  if (!pool) return null
  return { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount }
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
