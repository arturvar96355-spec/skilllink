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
