import { prisma } from '@/shared/db/prisma'
import type { Prisma } from '@/generated/prisma/client'

/** Действия, которые журналируются (раздел 15 ТЗ). Список расширяется по мере надобности. */
export type AuditAction =
  | 'university.create'
  | 'university.update'
  | 'university.archive'
  | 'program.create'
  | 'program.update'
  | 'program.skills.replace'
  | 'cooperation.create'
  | 'cooperation.update'
  | 'stage.status.change'
  | 'stage.fields.change'
  | 'stage.auto.recompute'
  | 'task.toggle'
  | 'application.create'
  | 'recommendation.generate'
  | 'recommendation.status.change'
  | 'document.create'
  | 'document.update'
  | 'document.status.change'
  | 'document.version.create'
  | 'document.package.generate'
  | 'meeting.create'
  | 'meeting.update'
  | 'portal.material.confirm'
  | 'portal.metrics.update'
  | 'datasource.sync'
  | 'product.version.release'
  | 'export.download'
  | 'import.apply'

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
    console.error('[AUDIT] не удалось записать действие', entry.action, error)
  }
}
