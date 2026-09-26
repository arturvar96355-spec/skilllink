import { prisma } from '@/shared/db/prisma'
import type { Prisma } from '@/generated/prisma/client'

/**
 * Доступ к таблице idempotency_keys (решение 123). Захват ключа — одна вставка
 * `ON CONFLICT DO NOTHING`: из одновременных запросов с одним ключом вставит
 * только один, остальные увидят его запись.
 */

export interface IdempotencyRow {
  requestHash: string
  status: 'IN_PROGRESS' | 'SUCCEEDED'
  responseStatus: number | null
  responseBody: unknown
  createdAt: Date
}

/** Удалить истёкший ключ, чтобы его можно было занять заново. */
export async function deleteExpired(userId: string, key: string, before: Date): Promise<void> {
  await prisma.idempotencyKey.deleteMany({ where: { userId, key, createdAt: { lt: before } } })
}

/** Занять ключ. true — занят этим запросом; false — ключ уже есть. */
export async function tryClaim(userId: string, key: string, requestHash: string): Promise<boolean> {
  const inserted = await prisma.$executeRaw`
    INSERT INTO idempotency_keys (user_id, key, request_hash, status)
    VALUES (${userId}, ${key}, ${requestHash}, 'IN_PROGRESS')
    ON CONFLICT (user_id, key) DO NOTHING`
  return inserted === 1
}

export async function find(userId: string, key: string): Promise<IdempotencyRow | null> {
  return prisma.idempotencyKey.findUnique({
    where: { userId_key: { userId, key } },
    select: { requestHash: true, status: true, responseStatus: true, responseBody: true, createdAt: true },
  })
}

export async function complete(userId: string, key: string, status: number, body: unknown): Promise<void> {
  await prisma.idempotencyKey.update({
    where: { userId_key: { userId, key } },
    data: {
      status: 'SUCCEEDED',
      responseStatus: status,
      responseBody: body === null ? undefined : (body as Prisma.InputJsonValue),
    },
  })
}

/** Отпустить ключ после неудачи: повтор с тем же ключом выполнится заново. */
export async function release(userId: string, key: string): Promise<void> {
  await prisma.idempotencyKey.deleteMany({ where: { userId, key, status: 'IN_PROGRESS' } })
}
