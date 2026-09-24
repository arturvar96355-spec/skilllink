import { prisma } from '@/shared/db/prisma'
import { ACTIVE_PROGRAM_WHERE } from '@/modules/programs/programs.rules'
import { latestPeriod } from '@/modules/skills/skills.repo'
import { buildOrderBy, parseSort, toSkipTake } from '@/shared/http/pagination'
import type { Prisma } from '@/generated/prisma/client'
import { OPEN_COOPERATION_STATUSES } from '@/modules/cooperation/cooperation.rules'
import type { RecommendationStatus } from '@/shared/contracts/enums'
import { RECOMMENDATION_SORT_FIELDS, type RecommendationListQuery } from './recommendations.schema'
import {
  COOPERATION_RULE_KEYS,
  OPEN_RECOMMENDATION_STATUSES,
  findObsolete,
  isSameOccurrence,
  planCooperationSync,
  recommendationKey,
  shouldReopen,
  type RecommendationDraft,
} from './recommendations.rules'

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
      //
      // При равном значении — сначала новые, как в блоке приоритетных действий
      // на главной.
      orderBy: buildOrderBy({ field, direction }, [], [{ createdAt: 'desc' }]),
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

/** Поля, которые пересборка переписывает у существующей записи: текст и данные правила. */
function draftFields(draft: RecommendationDraft) {
  return {
    type: draft.type,
    title: draft.title,
    description: draft.description,
    priority: draft.priority,
    justification: draft.justification,
    relatedData: draft.relatedData as Prisma.InputJsonValue,
    confidence: draft.confidence,
    cooperationId: draft.cooperationId,
  }
}

/**
 * Сохраняет черновики правил.
 *
 * Рекомендация опознаётся тройкой (ruleKey, objectType, objectId). Повторная генерация
 * обновляет текст и приоритет существующей записи, но **не трогает статус**: если сотрудник
 * уже отклонил предложение, оно не должно всплывать снова как новое. Исключение —
 * закрытая запись, чья проблема вернулась (`shouldReopen`).
 *
 * `drafts` приходят уже в порядке ленты. Новая запись получает время создания
 * на миллисекунду раньше предыдущей: список при равной важности сортируется
 * «сначала новые», и первой окажется самая важная. Без этого три записи,
 * созданные в одну миллисекунду, выстраивались в случайном порядке.
 */
export async function upsertDrafts(
  drafts: RecommendationDraft[],
  generatedAt: Date,
): Promise<UpsertResult> {
  let created = 0
  let updated = 0
  const keys: string[] = []

  for (const [index, draft] of drafts.entries()) {
    const key = recommendationKey(draft)
    keys.push(key)

    const existing = await prisma.recommendation.findUnique({
      where: {
        ruleKey_objectType_objectId: {
          ruleKey: draft.ruleKey,
          objectType: draft.objectType,
          objectId: draft.objectId,
        },
      },
      select: { id: true, status: true, resolvedById: true, ruleKey: true, relatedData: true },
    })

    if (existing) {
      const reopen = shouldReopen(existing)
      // Тот же случай проблемы — время создания прежнее, иначе лента уведомлений
      // показала бы давно известную просрочку новой.
      const sameOccurrence = isSameOccurrence(existing, draft)
      await prisma.recommendation.update({
        where: { id: existing.id },
        data: {
          // Вернувшаяся проблема — снова новая: открыта и стоит среди свежих.
          ...(reopen
            ? {
                status: 'NEW' as const,
                resolvedAt: null,
                resolvedById: null,
                resolutionComment: null,
                ...(sameOccurrence ? {} : { createdAt: new Date(generatedAt.getTime() - index) }),
              }
            : {}),
          ...draftFields(draft),
        },
      })
      if (reopen) created += 1
      else updated += 1
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
          createdAt: new Date(generatedAt.getTime() - index),
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
 * Затрагиваются открытые записи, включая принятые: «принято» при ушедшей
 * проблеме оставляло в работе то, что уже неправда. Отклонённые не трогаются —
 * это решение человека с основанием. Закрывает система: `resolvedById` пуст.
 */
export async function closeObsolete(actualKeys: string[]): Promise<number> {
  const open = await prisma.recommendation.findMany({
    where: { status: { in: [...OPEN_RECOMMENDATION_STATUSES] } },
    select: { id: true, ruleKey: true, objectType: true, objectId: true },
  })

  return closeBySystem(findObsolete(open, actualKeys))
}

async function closeBySystem(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0
  const result = await prisma.recommendation.updateMany({
    // Статус проверяется ещё раз: между чтением и записью сотрудник мог отклонить её сам.
    where: { id: { in: ids }, status: { in: [...OPEN_RECOMMENDATION_STATUSES] } },
    data: { status: 'DONE', resolvedAt: new Date(), resolvedById: null },
  })
  return result.count
}

/**
 * Сверяет открытые рекомендации одной связки с тем, что правила выдают сейчас.
 *
 * Вызывается после смены статуса или срока этапа. Новых записей не создаёт
 * и закрытых не открывает — это дело пересборки. Только то, что уже висит
 * открытым: всё ещё правда — обновляется текст (просрочка переходит на следующий
 * этап, число дней), неправда — закрывается системой.
 */
export async function syncCooperation(
  cooperationId: string,
  drafts: readonly RecommendationDraft[],
): Promise<{ updated: number; closed: number }> {
  const open = await prisma.recommendation.findMany({
    where: {
      objectType: 'Cooperation',
      objectId: cooperationId,
      ruleKey: { in: [...COOPERATION_RULE_KEYS] },
      status: { in: [...OPEN_RECOMMENDATION_STATUSES] },
    },
    select: { id: true, ruleKey: true },
  })

  const plan = planCooperationSync(open, drafts)
  for (const { id, draft } of plan.update) {
    await prisma.recommendation.update({ where: { id }, data: draftFields(draft) })
  }
  return { updated: plan.update.length, closed: await closeBySystem(plan.close) }
}

/**
 * Меняет статус, только если он всё ещё тот, из которого проверялся переход.
 * Иначе двойной клик или сотрудник на устаревшей странице переписали бы
 * чужое решение мимо таблицы переходов. `null` — статус уже другой.
 */
export async function updateStatus(
  id: string,
  from: RecommendationStatus,
  status: RecommendationStatus,
  userId: string,
  comment: string | null,
): Promise<RecommendationRow | null> {
  const isResolved = status === 'ACCEPTED' || status === 'DISMISSED' || status === 'DONE'
  const changed = await prisma.recommendation.updateMany({
    where: { id, status: from },
    data: {
      status,
      resolvedById: isResolved ? userId : null,
      resolvedAt: isResolved ? new Date() : null,
      // Обоснование системы не переписывается: комментарий человека живёт отдельным полем.
      resolutionComment: comment,
    },
  })
  if (changed.count === 0) return null
  return findById(id)
}

/** Связка со всем, что нужно правилам по связке (`draftsForCooperation`). */
const cooperationRuleSelect = {
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
      // Последнее движение по этапу — для правила «связка без движения».
      history: { select: { changedAt: true }, orderBy: { changedAt: 'desc' }, take: 1 },
      tasks: {
        where: { doneAt: { not: null } },
        select: { doneAt: true },
        orderBy: { doneAt: 'desc' },
        take: 1,
      },
    },
  },
} satisfies Prisma.CooperationSelect

/** Программа со всем, что нужно правилу о недостающих показателях. */
const programRuleSelect = {
  id: true,
  name: true,
  applicationCount: true,
  studentCount: true,
  groupCount: true,
  university: { select: { name: true } },
  _count: { select: { cooperations: true } },
} satisfies Prisma.EducationalProgramSelect

/**
 * Одна связка для правил. Закрытая связка правилам не нужна — как и в пересборке,
 * её рекомендации неактуальны: null.
 */
export async function loadCooperationForRules(id: string) {
  return prisma.cooperation.findFirst({
    where: { id, status: { in: [...OPEN_COOPERATION_STATUSES] } },
    select: cooperationRuleSelect,
  })
}

/** Одна действующая программа для правила о недостающих показателях. */
export async function loadProgramForRules(id: string) {
  return prisma.educationalProgram.findFirst({
    where: { id, ...ACTIVE_PROGRAM_WHERE },
    select: programRuleSelect,
  })
}

/** Исходные данные для правил. Один проход по базе вместо запроса на каждое правило. */
export async function loadGenerationInput() {
  const [cooperations, programs, demand, programSkills, productSkills] = await Promise.all([
    prisma.cooperation.findMany({
      where: { status: { in: [...OPEN_COOPERATION_STATUSES] } },
      select: cooperationRuleSelect,
    }),
    prisma.educationalProgram.findMany({
      where: ACTIVE_PROGRAM_WHERE,
      select: programRuleSelect,
    }),
    prisma.marketDemand.findMany({
      where: { period: (await latestPeriod()) ?? undefined },
      select: {
        skillId: true,
        value: true,
        region: true,
        skill: { select: { id: true, name: true } },
      },
    }),
    prisma.programSkill.findMany({
      where: { program: ACTIVE_PROGRAM_WHERE },
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
