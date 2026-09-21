import { prisma } from '@/shared/db/prisma'
import { ACTIVE_UNIVERSITY_STATUSES } from '@/modules/universities/universities.rules'

/** Связки, которые сейчас в работе. */
export async function countActiveCooperations(scope: { universityId?: string }): Promise<number> {
  return prisma.cooperation.count({
    where: { status: { in: ['DRAFT', 'ACTIVE'] }, ...scope },
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

/** Завершённые этапы со сроком — по ним считается доля закрытых вовремя. */
export async function findCompletedStagesWithDeadline(scope: { universityId?: string }) {
  return prisma.workflowStage.findMany({
    where: {
      status: 'COMPLETED',
      deadline: { not: null },
      completedAt: { not: null },
      ...(scope.universityId ? { cooperation: { universityId: scope.universityId } } : {}),
    },
    select: { deadline: true, completedAt: true },
  })
}

/** Связки, где известны и первый контакт, и начало занятий: по ним считается срок цикла. */
export async function findCycleDurations(scope: { universityId?: string }) {
  return prisma.cooperation.findMany({
    where: {
      firstContactAt: { not: null },
      classesStartAt: { not: null },
      ...scope,
    },
    select: { firstContactAt: true, classesStartAt: true },
  })
}

export async function findProgramsForRating(scope: { universityId?: string }, limit: number) {
  return prisma.educationalProgram.findMany({
    where: { status: 'ACTIVE', archivedAt: null, ...scope },
    select: {
      id: true,
      name: true,
      applicationCount: true,
      studentCount: true,
      groupCount: true,
      metricsSource: true,
      isMock: true,
      university: { select: { id: true, name: true } },
    },
    take: limit,
  })
}

export async function findProblemStages(scope: { universityId?: string }, now: Date, limit: number) {
  return prisma.workflowStage.findMany({
    where: {
      OR: [
        { deadline: { lt: now }, status: { notIn: ['COMPLETED', 'CANCELLED'] } },
        { status: 'BLOCKED' },
      ],
      ...(scope.universityId ? { cooperation: { universityId: scope.universityId } } : {}),
    },
    select: {
      stageNumber: true,
      title: true,
      status: true,
      deadline: true,
      blockingReason: true,
      cooperation: {
        select: {
          id: true,
          university: { select: { name: true } },
          program: { select: { name: true } },
        },
      },
    },
    orderBy: [{ deadline: 'asc' }],
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
    orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
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
    where: { status: 'ACTIVE', archivedAt: null, ...scope },
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
    where: { status: 'ACTIVE', archivedAt: null, ...scope },
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
      status: 'ACTIVE',
      archivedAt: null,
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
