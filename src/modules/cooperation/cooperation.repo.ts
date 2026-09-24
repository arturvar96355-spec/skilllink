import { prisma } from '@/shared/db/prisma'
import { textContains } from '@/shared/db/text-search'
import { buildOrderBy, parseSort, toSkipTake } from '@/shared/http/pagination'
import { intersectUniversityFilter } from '@/shared/auth/scope'
import type { Prisma } from '@/generated/prisma/client'
import { COOPERATION_SORT_FIELDS, type CooperationListQuery } from './cooperation.schema'

/** Контрольные даты заполнены не у всех связок. */
const NULLABLE_SORT_FIELDS = ['targetDate', 'classesStartAt'] as const
import type { DuplicateCooperation, NewStageData } from './cooperation.rules'
import { OPEN_COOPERATION_STATUSES } from '@/shared/contracts/enums'

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
  university: { select: { id: true, name: true, shortName: true } },
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

/** `null` — запрошен вуз вне области видимости: выборка заведомо пуста. */
export function buildWhere(
  query: CooperationListQuery,
  scope: { universityId?: string },
  now: Date,
): Prisma.CooperationWhereInput | null {
  const universityFilter = intersectUniversityFilter(scope, query.universityId)
  if (universityFilter === null) return null

  const where: Prisma.CooperationWhereInput = { ...universityFilter }

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
    const contains = textContains(query.q)
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
  if (where === null) return { rows: [], total: 0 }

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

/**
 * Очередь создания связок по программе: блокировка строки программы до конца транзакции.
 *
 * Проверка «такой связки ещё нет» и создание идут в одной транзакции, но без очереди
 * два одновременных «Создать» оба видели пустоту и заводили две одинаковые связки.
 * Связка всегда принадлежит программе, поэтому очереди по программе достаточно.
 */
export async function lockProgram(tx: Prisma.TransactionClient, programId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM educational_programs WHERE id = ${programId} FOR UPDATE`
}

/** Незакрытая связка с тем же «вуз + программа + продукт»; `productId: null` — продукт не выбран. */
export async function findOpenDuplicate(
  tx: Prisma.TransactionClient,
  key: { universityId: string; programId: string; productId: string | null; excludeId?: string },
): Promise<DuplicateCooperation | null> {
  const row = await tx.cooperation.findFirst({
    where: {
      universityId: key.universityId,
      programId: key.programId,
      productId: key.productId,
      status: { in: [...OPEN_COOPERATION_STATUSES] },
      ...(key.excludeId ? { id: { not: key.excludeId } } : {}),
    },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      status: true,
      university: { select: { name: true, shortName: true } },
      program: { select: { name: true } },
    },
  })
  if (!row) return null
  return {
    id: row.id,
    status: row.status,
    universityName: row.university.shortName ?? row.university.name,
    programName: row.program.name,
  }
}

/** Создаёт связку вместе со всеми 14 этапами и их чек-листами в транзакции вызывающего. */
export async function createWithStages(
  tx: Prisma.TransactionClient,
  data: Prisma.CooperationCreateInput,
  stages: NewStageData[],
): Promise<string> {
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
}

export async function update(
  id: string,
  data: Prisma.CooperationUpdateInput,
  client: Prisma.TransactionClient = prisma,
): Promise<void> {
  await client.cooperation.update({ where: { id }, data })
}
