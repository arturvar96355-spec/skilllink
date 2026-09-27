import { prisma } from '@/shared/db/prisma'
import { ACTIVE_COOPERATION_STATUSES } from '@/shared/contracts/enums'
import { ACTIVE_PROGRAM_WHERE } from '@/modules/programs/programs.rules'
import { ACTIVE_UNIVERSITY_STATUSES } from '@/modules/universities/universities.rules'
import { OPEN_COOPERATION_STATUSES } from '@/modules/cooperation/cooperation.rules'
import { CONTROL_STAGE_NUMBER } from '@/shared/config/workflow.config'
import { OVERDUE_STAGE_STATUSES } from '@/modules/workflow/workflow.rules'
import { TIE_BREAKER } from '@/shared/http/pagination'
import type { CooperationCountsDto } from '@/shared/contracts/analytics'

/**
 * Связки по статусам — один запрос на все числа главной.
 *
 * Показатель, воронка и блок «Связки в работе» берут числа отсюда, иначе они
 * расходятся между собой (решение 86).
 */
export async function countCooperationsByStatus(scope: {
  universityId?: string
}): Promise<CooperationCountsDto> {
  const rows = await prisma.cooperation.groupBy({
    by: ['status'],
    where: { ...scope },
    _count: { _all: true },
  })
  const count = (status: string) => rows.find((row) => row.status === status)?._count._all ?? 0
  const active = ACTIVE_COOPERATION_STATUSES.reduce((sum, status) => sum + count(status), 0)
  return {
    active,
    inWork: count('ACTIVE'),
    drafts: count('DRAFT'),
    paused: count('PAUSED'),
    completed: count('COMPLETED'),
    total: active + count('PAUSED') + count('COMPLETED'),
  }
}

/**
 * Связки, которые были в работе на момент `at`: заведены к нему и ещё не закрыты.
 * Паузу история не хранит, поэтому связки, стоящие на паузе сейчас, не считаются
 * и в прошлом — иначе сравнение показывало бы рост, которого не было.
 */
export async function countCooperationsOpenAt(
  scope: { universityId?: string },
  at: Date,
): Promise<number> {
  return prisma.cooperation.count({
    where: {
      ...scope,
      createdAt: { lte: at },
      status: { not: 'PAUSED' },
      OR: [{ closedAt: null }, { closedAt: { gt: at } }],
    },
  })
}

export async function countUniversitiesInWork(scope: { universityId?: string }): Promise<number> {
  return prisma.university.count({
    where: {
      status: { in: [...ACTIVE_UNIVERSITY_STATUSES] },
      archivedAt: null,
      ...(scope.universityId ? { id: scope.universityId } : {}),
    },
  })
}

/**
 * Этапы, по которым считается доля закрытых в срок: завершённые, со сроком.
 *
 * Без контрольного этапа 14: его закрывает система, когда закрыты остальные,
 * и его «срок» — это сроки этапов 1–13, уже учтённые по отдельности. С ним
 * одна и та же работа считалась бы дважды — по той же причине он не входит
 * в процент прохождения (docs/TECHNICAL_DECISIONS.md, решение 8).
 * Одно определение на главную и личный кабинет.
 */
export const ON_TIME_CANDIDATES = {
  status: 'COMPLETED',
  deadline: { not: null },
  completedAt: { not: null },
  stageNumber: { not: CONTROL_STAGE_NUMBER },
} as const

/** Завершённые этапы со сроком — по ним считается доля закрытых вовремя. */
export async function findCompletedStagesWithDeadline(scope: { universityId?: string }) {
  return prisma.workflowStage.findMany({
    where: {
      ...ON_TIME_CANDIDATES,
      ...(scope.universityId ? { cooperation: { universityId: scope.universityId } } : {}),
    },
    select: { deadline: true, completedAt: true, cooperation: { select: { isMock: true } } },
  })
}

/**
 * Есть ли среди связок демонстрационные — в пределах видимости.
 *
 * Показатели главной считаются по связкам и этапам, и признак демо-данных нужен
 * и им: иначе сводка по демонстрационному набору выдаётся за настоящую.
 */
export async function hasMockCooperations(scope: { universityId?: string }): Promise<boolean> {
  return (await prisma.cooperation.count({ where: { isMock: true, ...scope }, take: 1 })) > 0
}

export async function hasMockUniversities(scope: { universityId?: string }): Promise<boolean> {
  const where = { isMock: true, archivedAt: null, ...(scope.universityId ? { id: scope.universityId } : {}) }
  return (await prisma.university.count({ where, take: 1 })) > 0
}

/** Связки, где известны и первый контакт, и начало занятий: по ним считается срок цикла. */
export async function findCycleDurations(scope: { universityId?: string }) {
  return prisma.cooperation.findMany({
    where: {
      firstContactAt: { not: null },
      classesStartAt: { not: null },
      ...scope,
    },
    select: { firstContactAt: true, classesStartAt: true, isMock: true },
  })
}

/**
 * Программы для рейтинга — срез фиксированного размера.
 *
 * Срез обязан быть устойчивым: без `orderBy` СУБД вправе вернуть любые N строк,
 * и два одинаковых запроса дали бы разные баллы без изменения данных.
 *
 * Сам срез границы нормирования НЕ задаёт: их считает `findRatingBounds`
 * по всей базе. Иначе балл программы зависел бы от того, попала ли она
 * в первые двести строк.
 */
export async function findProgramsForRating(scope: { universityId?: string }, limit: number) {
  return prisma.educationalProgram.findMany({
    // Пустые показатели — в конец. По умолчанию PostgreSQL ставит NULL первыми при
    // сортировке по убыванию, и срез мог состоять только из программ без данных.
    orderBy: [
      { applicationCount: { sort: 'desc', nulls: 'last' } },
      { studentCount: { sort: 'desc', nulls: 'last' } },
      { id: 'asc' },
    ],
    where: { ...ACTIVE_PROGRAM_WHERE, ...scope },
    select: {
      id: true,
      name: true,
      applicationCount: true,
      studentCount: true,
      groupCount: true,
      metricsSource: true,
      isMock: true,
      university: { select: { id: true, name: true, shortName: true } },
    },
    take: limit,
  })
}

/**
 * Условие «этап стоит»: срок вышел или этап заблокирован, связка открыта.
 *
 * Только у действующих связок: этапы закрытой связки заморожены, и предлагать
 * по ним действие бессмысленно. Одно условие на выборку и на счётчик: если они
 * разойдутся, главная скажет «10 из 13», а в списке окажется другое множество.
 */
export function problemStageWhere(scope: { universityId?: string }, now: Date) {
  return {
    OR: [
      { deadline: { lt: now }, status: { in: [...OVERDUE_STAGE_STATUSES] } },
      { status: 'BLOCKED' as const },
    ],
    // Контрольный этап руками не меняется: он просрочен из-за незакрытых
    // этапов 1–13, и они в списке уже есть.
    stageNumber: { not: CONTROL_STAGE_NUMBER },
    cooperation: {
      status: { in: [...OPEN_COOPERATION_STATUSES] },
      ...(scope.universityId ? { universityId: scope.universityId } : {}),
    },
  }
}

/**
 * Статус и срок всех проблемных этапов — для общего числа и счётчиков групп
 * «Требует внимания» (решение 206). Серьёзность считает та же функция, что
 * у строк (`problemSeverity`), поэтому группы и строки не расходятся; условие
 * выборки — то же `problemStageWhere`, поэтому сумма групп равна общему числу.
 */
export async function findProblemStageStates(scope: { universityId?: string }, now: Date) {
  return prisma.workflowStage.findMany({
    where: problemStageWhere(scope, now),
    select: { status: true, deadline: true },
  })
}

export async function findProblemStages(scope: { universityId?: string }, now: Date, limit: number) {
  return prisma.workflowStage.findMany({
    where: problemStageWhere(scope, now),
    select: {
      id: true,
      stageNumber: true,
      title: true,
      status: true,
      deadline: true,
      blockingReason: true,
      // Ответственный за этап — тот же, по которому считает просрочки экран «Команда».
      responsible: { select: { id: true, fullName: true } },
      cooperation: {
        select: {
          id: true,
          university: { select: { name: true, shortName: true } },
          program: { select: { name: true } },
        },
      },
    },
    orderBy: [{ deadline: 'asc' }, TIE_BREAKER],
    take: limit,
  })
}

/**
 * Какие рекомендации могут попасть в «Приоритетные действия» (решение 206).
 *
 * Открытые, кроме `stage.overdue` (решение 180) и кроме отложенных защитой от
 * перегрузки (`isDeferred`): система сама придержала такую запись — у
 * ответственного много невыполненных, а балл ниже порога, — и поднимать её
 * на главную в «самое важное» значило бы спорить с самой собой.
 */
export function priorityRecommendationWhere(scope: { universityId?: string }) {
  return {
    status: { in: ['NEW' as const, 'IN_PROGRESS' as const] },
    ruleKey: { not: 'stage.overdue' },
    isDeferred: false,
    ...(scope.universityId ? { cooperation: { universityId: scope.universityId } } : {}),
  }
}

/**
 * Порядок «Приоритетных действий» (решение 206): приоритет, внутри него — балл.
 *
 * Приоритет — перечисление, Prisma сортирует по порядку объявления: LOW, MEDIUM,
 * HIGH, CRITICAL; убывание даёт критичные сверху. Раньше вторым ключом была
 * дата создания, и из 17 «высоких» на главную попадал случайный срез — запись
 * с баллом 48 %, а не с баллом 68 %. Балл без значения (запись до обучения) — в конец.
 */
export const PRIORITY_RECOMMENDATION_ORDER = [
  { priority: 'desc' as const },
  { score: { sort: 'desc' as const, nulls: 'last' as const } },
  { createdAt: 'desc' as const },
  TIE_BREAKER,
]

/**
 * Открытые рекомендации с наибольшим приоритетом — блок приоритетных действий.
 *
 * `stage.overdue` сюда не берётся (решение 180, п. 2): та же самая просрочка
 * уже названа в соседнем блоке «Требует внимания» (`findProblemStages`) —
 * этап, вуз и срок совпадали слово в слово, только формулировки отличались.
 * Здесь остаётся то, чего в «Требует внимания» нет: связка без движения,
 * критический дефицит навыка, связка без метрик программы, связка без продукта.
 */
export async function findPriorityRecommendations(
  scope: { universityId?: string },
  limit: number,
) {
  return prisma.recommendation.findMany({
    where: priorityRecommendationWhere(scope),
    orderBy: PRIORITY_RECOMMENDATION_ORDER,
    take: limit,
    select: {
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
      // Решение 119: балл и причины — в той же карточке рекомендации, что и в ленте.
      score: true,
      scoreBreakdown: true,
      reasons: true,
      isDeferred: true,
    },
  })
}

/**
 * Сколько открытых рекомендаций всего — **включая** `stage.overdue`, в отличие
 * от `findPriorityRecommendations` (исправление 187, находка ревью 27.09).
 *
 * Пустой список приоритетных действий не значит «рекомендаций нет вообще»:
 * если открыты только просрочки этапов, они не в `findPriorityRecommendations`
 * (решение 180), но не в нуле здесь — и главная должна сказать об этом, а не
 * «рекомендаций нет, всё закрыто».
 */
export async function countOpenRecommendations(scope: { universityId?: string }): Promise<number> {
  return prisma.recommendation.count({
    where: {
      status: { in: ['NEW', 'IN_PROGRESS'] },
      ...(scope.universityId ? { cooperation: { universityId: scope.universityId } } : {}),
    },
  })
}

/**
 * Операции, зафиксированные в журнале, и количество связок.
 * Показатель «ручных операций на связку» из концепции считается только по тому,
 * что система действительно журналирует, — это указано в пояснении к показателю.
 */
export async function countLoggedOperations(scope: { universityId?: string }) {
  const [operations, cooperations] = await Promise.all([
    prisma.auditLog.count({
      where: { objectType: { in: ['Cooperation', 'WorkflowStage', 'Task'] } },
    }),
    prisma.cooperation.count({ where: scope }),
  ])
  return { operations, cooperations }
}

/**
 * Все действующие программы для рейтинга вузов — без ограничения количества.
 *
 * Лимит здесь был бы тихой ошибкой: обрезанная выборка сдвигает границы нормирования,
 * и часть вузов получила бы баллы, посчитанные по другой шкале.
 */
export async function findProgramsForUniversityRating(scope: { universityId?: string }) {
  return prisma.educationalProgram.findMany({
    where: { ...ACTIVE_PROGRAM_WHERE, ...scope },
    select: {
      id: true,
      name: true,
      universityId: true,
      applicationCount: true,
      studentCount: true,
      groupCount: true,
      metricsSource: true,
    },
  })
}

/**
 * Границы нормирования по всем действующим программам — одним агрегатом.
 *
 * Альтернатива чтению всех строк: реестру вузов нужны рейтинги только показанной
 * страницы, но шкала обязана быть общей, иначе баллы страниц несравнимы.
 */
export async function findRatingBounds(scope: { universityId?: string }) {
  const result = await prisma.educationalProgram.aggregate({
    where: { ...ACTIVE_PROGRAM_WHERE, ...scope },
    _min: { applicationCount: true, studentCount: true, groupCount: true },
    _max: { applicationCount: true, studentCount: true, groupCount: true },
  })
  return result
}

/** Программы перечисленных вузов — для рейтинга одной страницы реестра. */
export async function findProgramsOfUniversities(
  universityIds: readonly string[],
  scope: { universityId?: string },
) {
  if (universityIds.length === 0) return []
  return prisma.educationalProgram.findMany({
    where: {
      ...ACTIVE_PROGRAM_WHERE,
      universityId: { in: [...universityIds] },
      ...scope,
    },
    select: {
      id: true,
      name: true,
      universityId: true,
      applicationCount: true,
      studentCount: true,
      groupCount: true,
      metricsSource: true,
    },
  })
}

/**
 * Связки в работе, где пользователь — ответственный. Статусы те же, что у показателя
 * «Активные связи» на дашборде, — иначе в кабинете и на дашборде одно слово
 * значило бы разное.
 */
export async function findActiveCooperationsOf(userId: string) {
  return prisma.cooperation.findMany({
    where: { responsibleId: userId, status: { in: [...ACTIVE_COOPERATION_STATUSES] } },
    select: { universityId: true, programId: true, isMock: true },
  })
}

/** Свои завершённые этапы со сроком — по ним доля закрытых вовремя. */
export async function findCompletedStagesWithDeadlineOf(userId: string) {
  return prisma.workflowStage.findMany({
    where: { responsibleId: userId, ...ON_TIME_CANDIDATES },
    select: { deadline: true, completedAt: true },
  })
}

/**
 * Свои просроченные этапы — по тем же правилам, что проблемные этапы дашборда:
 * контрольный этап не считается, закрытые связки тоже.
 */
export async function countOverdueStagesOf(userId: string, now: Date): Promise<number> {
  return prisma.workflowStage.count({ where: { responsibleId: userId, ...overdueStageWhere(now) } })
}

/**
 * Условие «этап просрочен» для выборок по сотрудникам — то же правило, что
 * `isOverdue` и бейдж карточки связки: срок вышел, этап в работе или заблокирован
 * (`OVERDUE_STAGE_STATUSES`), без контрольного этапа 14, только в незакрытых связках.
 * Одно условие на личный кабинет (`countOverdueStagesOf`) и экран «Команда»
 * (решение 203): иначе «просрочено 3» в профиле и в команде могли бы разойтись.
 */
export function overdueStageWhere(now: Date) {
  return {
    deadline: { lt: now },
    status: { in: [...OVERDUE_STAGE_STATUSES] },
    stageNumber: { not: CONTROL_STAGE_NUMBER },
    cooperation: { status: { in: [...OPEN_COOPERATION_STATUSES] } },
  }
}

/** Сколько действующих программ в рейтинге всего — а не в срезе, который считается. */
export async function countProgramsForRating(scope: { universityId?: string }): Promise<number> {
  return prisma.educationalProgram.count({ where: { ...ACTIVE_PROGRAM_WHERE, ...scope } })
}
