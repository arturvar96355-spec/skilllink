import { prisma } from '@/shared/db/prisma'
import { buildOrderBy, parseSort, toSkipTake } from '@/shared/http/pagination'
import type { Prisma } from '@/generated/prisma/client'
import { COOPERATION_SORT_FIELDS, type CooperationListQuery } from './cooperation.schema'

/** Контрольные даты заполнены не у всех связок. */
const NULLABLE_SORT_FIELDS = ['targetDate', 'classesStartAt'] as const
import type { NewStageData } from './cooperation.rules'

const userRefSelect = { id: true, fullName: true, role: true } satisfies Prisma.UserSelect

/** Для списка нужны все этапы: по ним считаются текущий этап и процент выполнения. */
const listSelect = {
  id: true,
  universityId: true,
  programId: true,
  productId: true,
  status: true,
  targetDate: true,
  classesStartAt: true,
  isMock: true,
  updatedAt: true,
  university: { select: { id: true, name: true } },
  program: { select: { id: true, name: true } },
  product: { select: { id: true, name: true } },
  responsible: { select: userRefSelect },
  stages: {
    orderBy: { stageNumber: 'asc' },
    select: {
      id: true,
      stageNumber: true,
      title: true,
      phase: true,
      status: true,
      deadline: true,
    },
  },
} satisfies Prisma.CooperationSelect

const detailSelect = {
  ...listSelect,
  goal: true,
  notes: true,
  firstContactAt: true,
  startedAt: true,
  closedAt: true,
  createdAt: true,
} satisfies Prisma.CooperationSelect

export type CooperationListRow = Prisma.CooperationGetPayload<{ select: typeof listSelect }>
export type CooperationDetailRow = Prisma.CooperationGetPayload<{ select: typeof detailSelect }>

export function buildWhere(
  query: CooperationListQuery,
  scope: { universityId?: string },
  now: Date,
): Prisma.CooperationWhereInput {
  const where: Prisma.CooperationWhereInput = {}

  if (scope.universityId) where.universityId = scope.universityId
  else if (query.universityId) where.universityId = query.universityId

  if (query.programId) where.programId = query.programId
  if (query.productId) where.productId = query.productId
  if (query.responsibleId) where.responsibleId = query.responsibleId
  if (query.status?.length) where.status = { in: query.status }

  if (query.onlyOverdue) {
    where.stages = {
      some: { deadline: { lt: now }, status: { notIn: ['COMPLETED', 'CANCELLED'] } },
    }
  }
  if (query.onlyBlocked) {
    where.stages = { ...(where.stages ?? {}), some: { status: 'BLOCKED' } }
  }

  if (query.q) {
    const contains = { contains: query.q, mode: 'insensitive' as const }
    where.OR = [
      { university: { name: contains } },
      { program: { name: contains } },
      { product: { name: contains } },
      { goal: contains },
    ]
  }

  return where
}

export async function findMany(
  query: CooperationListQuery,
  scope: { universityId?: string },
  now: Date,
): Promise<{ rows: CooperationListRow[]; total: number }> {
  const where = buildWhere(query, scope, now)
  const { field, direction } = parseSort(query.sort, COOPERATION_SORT_FIELDS, {
    field: 'updatedAt',
    direction: 'desc',
  })

  const [rows, total] = await Promise.all([
    prisma.cooperation.findMany({
      where,
      select: listSelect,
      orderBy: buildOrderBy({ field, direction }, NULLABLE_SORT_FIELDS),
      ...toSkipTake({ page: query.page, pageSize: query.pageSize }),
    }),
    prisma.cooperation.count({ where }),
  ])
  return { rows, total }
}

export async function findById(
  id: string,
  scope: { universityId?: string },
): Promise<CooperationDetailRow | null> {
  return prisma.cooperation.findFirst({
    where: { id, ...(scope.universityId ? { universityId: scope.universityId } : {}) },
    select: detailSelect,
  })
}

/** Создаёт связку вместе со всеми 14 этапами и их чек-листами одной транзакцией. */
export async function createWithStages(
  data: Prisma.CooperationCreateInput,
  stages: NewStageData[],
): Promise<string> {
  return prisma.$transaction(async (tx) => {
    const cooperation = await tx.cooperation.create({ data, select: { id: true } })

    for (const stage of stages) {
      await tx.workflowStage.create({
        data: {
          cooperationId: cooperation.id,
          stageNumber: stage.stageNumber,
          title: stage.title,
          phase: stage.phase,
          deadline: stage.deadline,
          responsibleId: stage.responsibleId,
          ...(stage.tasks.length > 0 ? { tasks: { createMany: { data: stage.tasks } } } : {}),
        },
      })
    }

    return cooperation.id
  })
}

export async function update(
  id: string,
  data: Prisma.CooperationUpdateInput,
): Promise<void> {
  await prisma.cooperation.update({ where: { id }, data })
}
