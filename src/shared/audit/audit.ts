import { prisma } from '@/shared/db/prisma'
import type { Prisma } from '@/generated/prisma/client'
import type { AuditActionCode } from '@/shared/contracts/audit'
import { log } from '@/shared/log/logger'

/**
 * Действия, которые журналируются (раздел 15 ТЗ). Сам список — в
 * `shared/contracts/audit.ts` (AUDIT_ACTIONS): по нему вкладка журнала строит
 * фильтр и подписи, и действие без подписи не соберётся.
 */
export type AuditAction = AuditActionCode

export interface AuditEntry {
  userId: string | null
  action: AuditAction
  objectType: string
  objectId: string
  /** Только служебные поля. Персональные данные сюда не пишутся. */
  payload?: Prisma.InputJsonValue
}

type Client = Prisma.TransactionClient | typeof prisma

/**
 * Запись в журнал действий.
 * Сбой журналирования не должен ломать основную операцию — ошибка только логируется.
 */
export async function writeAudit(entry: AuditEntry, client: Client = prisma): Promise<void> {
  try {
    await client.auditLog.create({
      data: {
        userId: entry.userId,
        action: entry.action,
        objectType: entry.objectType,
        objectId: entry.objectId,
        ...(entry.payload === undefined ? {} : { payload: entry.payload }),
      },
    })
  } catch (error) {
    // Ошибка — через общий журнал: текст Prisma с payload (в нём бывают ФИО и контакты)
    // урезается до причины, почта и телефоны маскируются (решение 133).
    log.error('[AUDIT] не удалось записать действие', { action: entry.action, err: error })
  }
}

export interface AuditOnceResult {
  /** true — запись сделана сейчас; false — такая же уже была в окне. */
  created: boolean
  /** Когда записано: сейчас или время уже существующей записи. */
  at: Date
}

/**
 * Записать действие один раз (решение 200, «Принял, беру в работу»): если этот же
 * пользователь уже записал это же действие над этим же объектом не раньше `since`,
 * новая запись не создаётся и возвращается время прежней. Проверка и вставка —
 * под рекомендательной блокировкой транзакции на ключ «действие + объект + автор»:
 * два одновременных нажатия не запишут две строки.
 *
 * В отличие от `writeAudit`, сбой базы НЕ проглатывается: здесь запись в журнал —
 * и есть сама операция, и вызывающий должен знать, удалась ли она.
 */
export async function recordAuditOnce(
  entry: AuditEntry & { userId: string },
  since: Date,
): Promise<AuditOnceResult> {
  return prisma.$transaction(async (tx) => {
    const lockKey = `audit-once:${entry.action}:${entry.objectType}:${entry.objectId}:${entry.userId}`
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`
    const existing = await tx.auditLog.findFirst({
      where: {
        action: entry.action,
        objectType: entry.objectType,
        objectId: entry.objectId,
        userId: entry.userId,
        createdAt: { gte: since },
      },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    })
    if (existing) return { created: false, at: existing.createdAt }
    const row = await tx.auditLog.create({
      data: {
        userId: entry.userId,
        action: entry.action,
        objectType: entry.objectType,
        objectId: entry.objectId,
        ...(entry.payload === undefined ? {} : { payload: entry.payload }),
      },
      select: { createdAt: true },
    })
    return { created: true, at: row.createdAt }
  })
}
