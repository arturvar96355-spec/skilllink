import { prisma } from '@/shared/db/prisma'
import type { Prisma } from '@/generated/prisma/client'
import type { TimelineEventType } from '@/shared/contracts/data-quality'

/**
 * Источники ленты 360 вуза (решение 134). Каждый источник отдаёт события строго
 * раньше курсора — не больше `take` штук — и все события ровно в момент курсора
 * (их немного; порядок среди них решает id, а его сравнивает приложение).
 */

const userRefSelect = { id: true, fullName: true, role: true } satisfies Prisma.UserSelect

export interface Window {
  /** Момент курсора; null — первая страница. */
  before: Date | null
  take: number
}

/**
 * Условие по времени для одного запроса: `< before` с лимитом или `= before` без него.
 * Первая страница — один запрос с лимитом.
 */
function slices(field: string, window: Window): Array<{ where: object; take?: number }> {
  if (!window.before) return [{ where: {}, take: window.take }]
  return [
    { where: { [field]: { lt: window.before } }, take: window.take },
    { where: { [field]: window.before } },
  ]
}

async function fetchSlices<T>(
  field: string,
  window: Window,
  query: (where: object, take: number | undefined) => Promise<T[]>,
): Promise<T[]> {
  const parts = await Promise.all(slices(field, window).map((slice) => query(slice.where, slice.take)))
  return parts.flat()
}

const linkedToUniversity = (universityId: string) => ({
  OR: [{ universityId }, { cooperation: { universityId } }, { program: { universityId } }],
})

export async function universityExists(id: string): Promise<boolean> {
  return (await prisma.university.findUnique({ where: { id }, select: { id: true } })) !== null
}

export async function loadTimeline(universityId: string, types: readonly TimelineEventType[], window: Window, now: Date) {
  const want = (type: TimelineEventType) => types.includes(type)
  const none = Promise.resolve([])

  const cooperations = want('cooperation')
    ? fetchSlices('createdAt', window, (where, take) =>
        prisma.cooperation.findMany({
          where: { universityId, ...where },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take,
          select: {
            id: true,
            createdAt: true,
            program: { select: { name: true } },
            product: { select: { name: true } },
            responsible: { select: userRefSelect },
          },
        }),
      )
    : none

  const stages = want('stage')
    ? fetchSlices('changedAt', window, (where, take) =>
        prisma.stageHistory.findMany({
          where: { stage: { cooperation: { universityId } }, ...where },
          orderBy: [{ changedAt: 'desc' }, { id: 'desc' }],
          take,
          select: {
            id: true,
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
      )
    : none

  // Встречи — только проведённые: лента рассказывает, что было, а не что запланировано.
  const meetings = want('meeting')
    ? fetchSlices('date', window, (where, take) =>
        prisma.meeting.findMany({
          where: { AND: [linkedToUniversity(universityId), { date: { lte: now } }, where] },
          orderBy: [{ date: 'desc' }, { id: 'desc' }],
          take,
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
      )
    : none

  const documents = want('document')
    ? fetchSlices('changedAt', window, (where, take) =>
        prisma.documentHistory.findMany({
          where: { document: linkedToUniversity(universityId), ...where },
          orderBy: [{ changedAt: 'desc' }, { id: 'desc' }],
          take,
          select: {
            id: true,
            toStatus: true,
            comment: true,
            changedAt: true,
            changedBy: { select: userRefSelect },
            document: {
              select: { id: true, title: true, version: true, cooperationId: true, program: { select: { name: true } } },
            },
          },
        }),
      )
    : none

  const applications = want('application')
    ? fetchSlices('submittedAt', window, (where, take) =>
        prisma.application.findMany({
          where: { universityId, ...where },
          orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
          take,
          select: {
            id: true,
            quantity: true,
            status: true,
            comment: true,
            submittedAt: true,
            program: { select: { name: true } },
            createdBy: { select: userRefSelect },
          },
        }),
      )
    : none

  const recommendationScope = want('recommendation') ? await recommendationWhere(universityId) : null
  const recommendations = recommendationScope
    ? fetchSlices('createdAt', window, (where, take) =>
        prisma.recommendation.findMany({
          where: { AND: [recommendationScope, where] },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take,
          select: { id: true, title: true, priority: true, createdAt: true, cooperationId: true },
        }),
      )
    : none

  // Смены статусов рекомендаций — из журнала: отдельной истории у рекомендаций нет.
  const recommendationStatuses = recommendationScope
    ? prisma.recommendation
        .findMany({ where: recommendationScope, select: { id: true } })
        .then((rows) =>
          rows.length === 0
            ? []
            : fetchSlices('createdAt', window, (where, take) =>
                prisma.auditLog.findMany({
                  where: {
                    action: 'recommendation.status.change',
                    objectType: 'Recommendation',
                    objectId: { in: rows.map((row) => row.id) },
                    ...where,
                  },
                  orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
                  take,
                  select: { id: true, objectId: true, payload: true, createdAt: true, user: { select: userRefSelect } },
                }),
              ),
        )
    : none

  // Основания обработки ПД контактов — только факт из журнала: в payload нет ФИО.
  const contacts = want('contact')
    ? fetchSlices('createdAt', window, (where, take) =>
        prisma.auditLog.findMany({
          where: {
            action: { in: ['contact.basis.set', 'contact.consent.withdraw', 'contact.anonymize'] },
            payload: { path: ['universityId'], equals: universityId },
            ...where,
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take,
          select: { id: true, action: true, createdAt: true, user: { select: userRefSelect } },
        }),
      )
    : none

  // Изменения записи вуза и слияния, где он был целью или дублем.
  const audit = want('audit')
    ? fetchSlices('createdAt', window, (where, take) =>
        prisma.auditLog.findMany({
          where: {
            objectType: 'University',
            OR: [{ objectId: universityId }, { payload: { path: ['sourceId'], equals: universityId } }],
            ...where,
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take,
          select: { id: true, action: true, objectId: true, payload: true, createdAt: true, user: { select: userRefSelect } },
        }),
      )
    : none

  const [c, s, m, d, a, r, rs, ct, au] = await Promise.all([
    cooperations,
    stages,
    meetings,
    documents,
    applications,
    recommendations,
    recommendationStatuses,
    contacts,
    audit,
  ])
  return {
    cooperations: c,
    stages: s,
    meetings: m,
    documents: d,
    applications: a,
    recommendations: r,
    recommendationStatuses: rs,
    contacts: ct,
    audit: au,
  }
}

export type TimelineSources = Awaited<ReturnType<typeof loadTimeline>>

/** Рекомендации вуза: по его связкам, его программам и по нему самому. */
async function recommendationWhere(universityId: string): Promise<Prisma.RecommendationWhereInput> {
  const programs = await prisma.educationalProgram.findMany({ where: { universityId }, select: { id: true } })
  return {
    OR: [
      { cooperation: { universityId } },
      { objectType: 'EducationalProgram', objectId: { in: programs.map((row) => row.id) } },
      { objectType: 'University', objectId: universityId },
    ],
  }
}
