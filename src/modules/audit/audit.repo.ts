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
