import { prisma } from '@/shared/db/prisma'
import { buildOrderBy, parseSort, toSkipTake } from '@/shared/http/pagination'
import type { Prisma } from '@/generated/prisma/client'
import { RECOMMENDATION_SORT_FIELDS, type RecommendationListQuery } from './recommendations.schema'
import type { RecommendationDraft } from './recommendations.rules'

const recommendationSelect = {
  id: true,
  type: true,
  ruleKey: true,
  objectType: true,
  objectId: true,
  title: true,
  description: true,
  priority: true,
  justification: true,
  relatedData: true,
  confidence: true,
  status: true,
  resolutionComment: true,
  cooperationId: true,
  createdAt: true,
  updatedAt: true,
  resolvedAt: true,
} satisfies Prisma.RecommendationSelect

export type RecommendationRow = Prisma.RecommendationGetPayload<{
  select: typeof recommendationSelect
}>

export async function findMany(
  query: RecommendationListQuery,
  scope: { universityId?: string },
): Promise<{ rows: RecommendationRow[]; total: number }> {
  const where: Prisma.RecommendationWhereInput = {}

  if (query.type?.length) where.type = { in: query.type }
  if (query.status?.length) where.status = { in: query.status }
  if (query.priority?.length) where.priority = { in: query.priority }
  if (query.cooperationId) where.cooperationId = query.cooperationId

  // Фильтр по региону работает только для рекомендаций, привязанных к связке:
  // у рекомендации по навыку своего региона нет.
  if (query.region) where.cooperation = { university: { region: query.region } }

  // Представитель вуза рекомендаций не видит вовсе — проверка делается в сервисе.
  // Здесь фильтр остаётся на случай, если право когда-нибудь будет выдано.
  if (scope.universityId) where.cooperation = { universityId: scope.universityId }

  const { field, direction } = parseSort(query.sort, RECOMMENDATION_SORT_FIELDS, {
    field: 'createdAt',
    direction: 'desc',
  })

  const [rows, total] = await Promise.all([
    prisma.recommendation.findMany({
      where,
      select: recommendationSelect,
      // Приоритет — перечисление, Prisma сортирует его по порядку объявления
      // (LOW, MEDIUM, HIGH, CRITICAL), поэтому убывание даёт критичные сверху.
      orderBy: buildOrderBy({ field, direction }),
      ...toSkipTake({ page: query.page, pageSize: query.pageSize }),
    }),
    prisma.recommendation.count({ where }),
  ])
  return { rows, total }
}

export async function findById(id: string): Promise<RecommendationRow | null> {
  return prisma.recommendation.findUnique({ where: { id }, select: recommendationSelect })
}

/** P2002 — нарушение уникального ограничения: запись уже создал параллельный запрос. */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'P2002'
  )
}

export interface UpsertResult {
  created: number
  updated: number
  keys: string[]
}

/**
 * Сохраняет черновики правил.
 *
 * Рекомендация опознаётся тройкой (ruleKey, objectType, objectId). Повторная генерация
 * обновляет текст и приоритет существующей записи, но **не трогает статус**: если сотрудник
 * уже отклонил предложение, оно не должно всплывать снова как новое.
 */
export async function upsertDrafts(drafts: RecommendationDraft[]): Promise<UpsertResult> {
  let created = 0
  let updated = 0
  const keys: string[] = []

  for (const draft of drafts) {
    const key = `${draft.ruleKey}::${draft.objectType}::${draft.objectId}`
    keys.push(key)

    const existing = await prisma.recommendation.findUnique({
      where: {
        ruleKey_objectType_objectId: {
          ruleKey: draft.ruleKey,
          objectType: draft.objectType,
          objectId: draft.objectId,
        },
      },
      select: { id: true, status: true },
    })

    if (existing) {
      await prisma.recommendation.update({
        where: { id: existing.id },
        data: {
          type: draft.type,
          title: draft.title,
          description: draft.description,
          priority: draft.priority,
          justification: draft.justification,
          relatedData: draft.relatedData as Prisma.InputJsonValue,
          confidence: draft.confidence,
          cooperationId: draft.cooperationId,
        },
      })
      updated += 1
      continue
    }

    // Два одновременных запуска генерации гонятся за одну и ту же запись.
    // Уникальный ключ отсечёт второго — это штатная гонка, а не ошибка пользователя:
    // проигравший просто обновляет уже созданную запись.
    try {
      await prisma.recommendation.create({
        data: {
          ruleKey: draft.ruleKey,
          type: draft.type,
          objectType: draft.objectType,
          objectId: draft.objectId,
          title: draft.title,
          description: draft.description,
          priority: draft.priority,
          justification: draft.justification,
          relatedData: draft.relatedData as Prisma.InputJsonValue,
          confidence: draft.confidence,
          cooperationId: draft.cooperationId,
        },
      })
      created += 1
    } catch (error) {
      if (!isUniqueViolation(error)) throw error

      await prisma.recommendation.update({
        where: {
          ruleKey_objectType_objectId: {
            ruleKey: draft.ruleKey,
            objectType: draft.objectType,
            objectId: draft.objectId,
          },
        },
        data: {
          title: draft.title,
          description: draft.description,
          priority: draft.priority,
          justification: draft.justification,
          relatedData: draft.relatedData as Prisma.InputJsonValue,
          confidence: draft.confidence,
          cooperationId: draft.cooperationId,
        },
      })
      updated += 1
    }
  }

  return { created, updated, keys }
}

/**
 * Закрывает рекомендации, которые правила больше не выдают: проблема решена.
 *
 * `actualKeys` — всё, что правила признали актуальным, включая то, что не попало
 * в ответ из-за лимита показа. Закрывать «лишнее по лимиту» как выполненное нельзя:
 * проблема никуда не делась, а система соврала бы, что её решили.
 *
 * Затрагиваются только открытые записи — решение сотрудника не переписывается.
 */
export async function closeObsolete(actualKeys: string[]): Promise<number> {
  const open = await prisma.recommendation.findMany({
    where: { status: { in: ['NEW', 'IN_PROGRESS'] } },
    select: { id: true, ruleKey: true, objectType: true, objectId: true },
  })

  const actual = new Set(actualKeys)
  const obsolete = open
    .filter((row) => !actual.has(`${row.ruleKey}::${row.objectType}::${row.objectId}`))
    .map((row) => row.id)

  if (obsolete.length === 0) return 0

  const result = await prisma.recommendation.updateMany({
    where: { id: { in: obsolete } },
    data: { status: 'DONE', resolvedAt: new Date() },
  })
  return result.count
}

export async function updateStatus(
  id: string,
  status: 'NEW' | 'IN_PROGRESS' | 'ACCEPTED' | 'DISMISSED' | 'DONE',
  userId: string,
  comment: string | null,
): Promise<RecommendationRow> {
  const isResolved = status === 'ACCEPTED' || status === 'DISMISSED' || status === 'DONE'
  return prisma.recommendation.update({
    where: { id },
    data: {
      status,
      resolvedById: isResolved ? userId : null,
      resolvedAt: isResolved ? new Date() : null,
      // Обоснование системы не переписывается: комментарий человека живёт отдельным полем.
      resolutionComment: comment,
    },
    select: recommendationSelect,
  })
}

/** Исходные данные для правил. Один проход по базе вместо запроса на каждое правило. */
export async function loadGenerationInput(now: Date) {
  const [cooperations, programs, demand, programSkills, productSkills] = await Promise.all([
    prisma.cooperation.findMany({
      where: { status: { in: ['DRAFT', 'ACTIVE', 'PAUSED'] } },
      select: {
        id: true,
        productId: true,
        updatedAt: true,
        university: { select: { id: true, name: true } },
        program: { select: { id: true, name: true } },
        stages: {
          orderBy: { stageNumber: 'asc' },
          select: {
            stageNumber: true,
            title: true,
            status: true,
            deadline: true,
            responsible: { select: { fullName: true } },
          },
        },
      },
    }),
    prisma.educationalProgram.findMany({
      where: { status: 'ACTIVE', archivedAt: null },
      select: {
        id: true,
        name: true,
        applicationCount: true,
        studentCount: true,
        groupCount: true,
        university: { select: { name: true } },
        _count: { select: { cooperations: true } },
      },
    }),
    prisma.marketDemand.findMany({
      where: { period: await latestPeriod(now) },
      select: { skillId: true, value: true, skill: { select: { id: true, name: true } } },
    }),
    prisma.programSkill.findMany({
      where: { program: { status: 'ACTIVE', archivedAt: null } },
      select: { programId: true, skillId: true, level: true },
    }),
    prisma.productSkill.findMany({
      where: { product: { status: 'ACTIVE' } },
      select: {
        skillId: true,
        relevance: true,
        product: { select: { id: true, name: true } },
      },
    }),
  ])

  return { cooperations, programs, demand, programSkills, productSkills }
}

async function latestPeriod(_now: Date): Promise<string | undefined> {
  const row = await prisma.marketDemand.findFirst({
    orderBy: { period: 'desc' },
    select: { period: true },
  })
  return row?.period
}

/** Ключ объекта рекомендации для словаря имён. */
export function targetKey(objectType: string, objectId: string): string {
  return `${objectType}:${objectId}`
}

/**
 * Читаемые имена объектов рекомендаций — одним запросом на тип, для всей страницы.
 *
 * Заголовок рекомендации объект не называет: «Просрочен этап 6: Подписание
 * документов» не говорит, какой вуз, а две «Нет данных по программе» подряд
 * неотличимы. Имя берётся из самого объекта.
 */
export async function resolveTargetLabels(
  targets: ReadonlyArray<{ objectType: string; objectId: string }>,
): Promise<Map<string, string>> {
  const idsOf = (type: string) => [
    ...new Set(targets.filter((item) => item.objectType === type).map((item) => item.objectId)),
  ]
  const [cooperations, programs, universities, skills] = await Promise.all([
    idsOf('Cooperation').length
      ? prisma.cooperation.findMany({
          where: { id: { in: idsOf('Cooperation') } },
          select: {
            id: true,
            university: { select: { name: true, shortName: true } },
            program: { select: { name: true } },
          },
        })
      : [],
    idsOf('EducationalProgram').length
      ? prisma.educationalProgram.findMany({
          where: { id: { in: idsOf('EducationalProgram') } },
          select: { id: true, name: true, university: { select: { name: true, shortName: true } } },
        })
      : [],
    idsOf('University').length
      ? prisma.university.findMany({
          where: { id: { in: idsOf('University') } },
          select: { id: true, name: true },
        })
      : [],
    idsOf('Skill').length
      ? prisma.skill.findMany({ where: { id: { in: idsOf('Skill') } }, select: { id: true, name: true } })
      : [],
  ])

  const labels = new Map<string, string>()
  for (const row of cooperations) {
    labels.set(
      targetKey('Cooperation', row.id),
      `${row.university.shortName ?? row.university.name} — ${row.program.name}`,
    )
  }
  for (const row of programs) {
    labels.set(
      targetKey('EducationalProgram', row.id),
      `${row.name} · ${row.university.shortName ?? row.university.name}`,
    )
  }
  for (const row of universities) labels.set(targetKey('University', row.id), row.name)
  for (const row of skills) labels.set(targetKey('Skill', row.id), `Навык «${row.name}»`)
  return labels
}
