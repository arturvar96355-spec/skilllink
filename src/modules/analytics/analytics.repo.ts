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
 * Раньше «активные» считались отдельным запросом, воронка — по списку, блок
 * «Связки в работе» — по своему: меню говорило 8, шапка 7, фильтр 6, и ни одно
 * число не объясняло другое (решение 86).
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
 * одна и та же работа считалась дважды — по той же причине он не входит
 * в процент прохождения (решение 8). Одно определение на главную и личный кабинет.
 */
const ON_TIME_CANDIDATES = {
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
 * Показатели главной считаются по связкам и этапам, а признак демо-данных у них
 * всегда был «нет»: сводка по демонстрационному набору выдавалась за настоящую
 * (CLAUDE.md, «Данные»).
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
 * и два одинаковых запроса давали разные баллы без изменения данных.
 *
 * Сам срез границы нормирования НЕ задаёт: их считает `findRatingBounds`
 * по всей базе. Иначе балл программы зависел бы от того, попала ли она
 * в первые двести строк.
 */
export async function findProgramsForRating(scope: { universityId?: string }, limit: number) {
  return prisma.educationalProgram.findMany({
    // Пустые показатели — в конец. По умолчанию PostgreSQL ставит NULL первыми при
    // сортировке по убыванию: при двухстах программах без заявок срез состоял
    // только из них, и программы с данными в рейтинг не попадали.
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
 * Этапы, требующие внимания: просроченные и заблокированные.
 *
 * Только у действующих связок. Закрытая связка проблем не создаёт: её этапы
 * заморожены, и предлагать по ним действие — значит заполнять дашборд тем,
 * на что никто не может повлиять.
 */
/**
 * Условие «этап стоит»: срок вышел или этап заблокирован, связка открыта.
 *
 * Одно на выборку и на счётчик: если они разойдутся, главная скажет
 * «10 из 13», а в списке окажется другое множество.
 */
function problemStageWhere(scope: { universityId?: string }, now: Date) {
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

export async function countProblemStages(scope: { universityId?: string }, now: Date): Promise<number> {
  return prisma.workflowStage.count({ where: problemStageWhere(scope, now) })
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

/** Открытые рекомендации с наибольшим приоритетом — блок приоритетных действий. */
export async function findPriorityRecommendations(
  scope: { universityId?: string },
  limit: number,
) {
  return prisma.recommendation.findMany({
    where: {
      status: { in: ['NEW', 'IN_PROGRESS'] },
      ...(scope.universityId ? { cooperation: { universityId: scope.universityId } } : {}),
    },
    // Приоритет — перечисление, Prisma сортирует по порядку объявления:
    // LOW, MEDIUM, HIGH, CRITICAL. Убывание даёт критичные сверху.
    orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }, TIE_BREAKER],
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
  return prisma.workflowStage.count({
    where: {
      responsibleId: userId,
      deadline: { lt: now },
      status: { in: [...OVERDUE_STAGE_STATUSES] },
      stageNumber: { not: CONTROL_STAGE_NUMBER },
      cooperation: { status: { in: [...OPEN_COOPERATION_STATUSES] } },
    },
  })
}

/** Сколько действующих программ в рейтинге всего — а не в срезе, который считается. */
export async function countProgramsForRating(scope: { universityId?: string }): Promise<number> {
  return prisma.educationalProgram.count({ where: { ...ACTIVE_PROGRAM_WHERE, ...scope } })
}
