import { prisma } from '@/shared/db/prisma'
import { TIE_BREAKER, toSkipTake } from '@/shared/http/pagination'
import type { Prisma } from '@/generated/prisma/client'
import type { AuditListQuery } from './audit.schema'

const userRefSelect = { id: true, fullName: true, role: true } satisfies Prisma.UserSelect

export async function findAuditEntries(query: AuditListQuery) {
  const where: Prisma.AuditLogWhereInput = {}
  if (query.action) where.action = query.action
  if (query.objectType) where.objectType = query.objectType
  if (query.objectId) where.objectId = query.objectId
  if (query.userId) where.userId = query.userId
  if (query.from || query.to) {
    where.createdAt = {
      ...(query.from ? { gte: new Date(query.from) } : {}),
      ...(query.to ? { lte: new Date(query.to) } : {}),
    }
  }

  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, TIE_BREAKER],
      select: {
        id: true,
        action: true,
        objectType: true,
        objectId: true,
        payload: true,
        createdAt: true,
        user: { select: userRefSelect },
      },
      ...toSkipTake({ page: query.page, pageSize: query.pageSize }),
    }),
    prisma.auditLog.count({ where }),
  ])
  return { rows, total }
}

/**
 * Связка этапов и пунктов чек-листа — для ссылки из журнала. Удалённый объект
 * (этапы не удаляются, но журнал живёт дольше данных) просто без ссылки.
 */
export async function findCooperationsOfObjects(
  stageIds: string[],
  taskIds: string[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>()
  if (stageIds.length > 0) {
    const stages = await prisma.workflowStage.findMany({
      where: { id: { in: [...new Set(stageIds)] } },
      select: { id: true, cooperationId: true },
    })
    for (const stage of stages) result.set(stage.id, stage.cooperationId)
  }
  if (taskIds.length > 0) {
    const tasks = await prisma.task.findMany({
      where: { id: { in: [...new Set(taskIds)] } },
      select: { id: true, stage: { select: { cooperationId: true } } },
    })
    for (const task of tasks) result.set(task.id, task.stage.cooperationId)
  }
  return result
}

/** Существует ли вуз: лента несуществующего вуза — «не найден», а не пустой список. */
export async function findUniversityRef(id: string) {
  return prisma.university.findUnique({
    where: { id },
    select: { id: true },
  })
}

/**
 * Источники ленты событий вуза. Берётся с запасом по каждому виду,
 * потом всё сливается и обрезается до нужного количества.
 */
export async function loadUniversityEvents(universityId: string, limit: number) {
  /**
   * С запасом на источник, а не ровно `limit`.
   *
   * События склеиваются из пяти источников и сортируются по времени: если брать
   * из каждого ровно `limit`, а все свежие события окажутся в одном, склейка даст
   * ровно `limit` строк — и признак «есть ещё» окажется ложным при полной истории
   * впереди. Запас гарантирует, что превышение видно.
   */
  const perSource = limit * 2

  const [cooperations, stageHistory, documentHistory, meetings, applications] = await Promise.all([
    prisma.cooperation.findMany({
      where: { universityId },
      orderBy: { createdAt: 'desc' },
      take: perSource,
      select: {
        id: true,
        createdAt: true,
        program: { select: { name: true } },
        product: { select: { name: true } },
        responsible: { select: userRefSelect },
      },
    }),
    prisma.stageHistory.findMany({
      where: { stage: { cooperation: { universityId } } },
      orderBy: { changedAt: 'desc' },
      take: perSource,
      select: {
        id: true,
        fromStatus: true,
        toStatus: true,
        comment: true,
        changedAt: true,
        changedBy: { select: userRefSelect },
        stage: {
          select: {
            stageNumber: true,
            title: true,
            result: true,
            cooperationId: true,
            cooperation: { select: { program: { select: { name: true } } } },
          },
        },
      },
    }),
    prisma.documentHistory.findMany({
      where: {
        document: {
          OR: [
            { universityId },
            { cooperation: { universityId } },
            { program: { universityId } },
          ],
        },
      },
      orderBy: { changedAt: 'desc' },
      take: perSource,
      select: {
        id: true,
        fromStatus: true,
        toStatus: true,
        comment: true,
        changedAt: true,
        changedBy: { select: userRefSelect },
        document: {
          select: {
            title: true,
            version: true,
            cooperationId: true,
            program: { select: { name: true } },
          },
        },
      },
    }),
    prisma.meeting.findMany({
      where: {
        OR: [
          { universityId },
          { cooperation: { universityId } },
          { program: { universityId } },
        ],
      },
      orderBy: { date: 'desc' },
      take: perSource,
      select: {
        id: true,
        date: true,
        topic: true,
        result: true,
        cooperationId: true,
        responsible: { select: userRefSelect },
        program: { select: { name: true } },
      },
    }),
    prisma.application.findMany({
      where: { universityId },
      orderBy: { submittedAt: 'desc' },
      take: perSource,
      select: {
        id: true,
        quantity: true,
        comment: true,
        submittedAt: true,
        program: { select: { name: true } },
        createdBy: { select: userRefSelect },
      },
    }),
  ])

  return { cooperations, stageHistory, documentHistory, meetings, applications }
}

// ─────────────── Выгрузка для внешней системы сбора событий (решение 133) ───────────────

/**
 * Записи журнала после `afterId` в порядке (время, id) — все колонки модели,
 * какие бы в ней ни появились (`select` не задан намеренно: цепочка хешей и другие
 * будущие колонки уходят в выгрузку без правки этого места).
 *
 * `afterId` неизвестен — `null`: курсор потерян (запись удалена по сроку хранения),
 * выгрузку надо начать заново или с другого курсора.
 */
export async function findAuditPageAfter(afterId: string | null, limit: number) {
  let where: Prisma.AuditLogWhereInput = {}
  if (afterId) {
    const cursor = await prisma.auditLog.findUnique({ where: { id: afterId }, select: { id: true, createdAt: true } })
    if (!cursor) return null
    where = {
      OR: [{ createdAt: { gt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { gt: cursor.id } }],
    }
  }
  return prisma.auditLog.findMany({ where, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: limit })
}
