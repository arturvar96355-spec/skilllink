import { prisma } from '@/shared/db/prisma'
import { parseSort, toSkipTake } from '@/shared/http/pagination'
import type { Prisma } from '@/generated/prisma/client'
import { CONTROL_STAGE_NUMBER } from '@/shared/config/workflow.config'
import { computeControlStatus } from '@/modules/workflow/workflow.rules'
import { PRODUCT_SORT_FIELDS, type ProductListQuery } from './products.schema'
import { BULK_TARGET_STATUSES } from './products.rules'

const listSelect = {
  id: true,
  name: true,
  category: true,
  version: true,
  status: true,
  documentationUrl: true,
  isMock: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { skills: true, cooperations: true } },
} satisfies Prisma.ITProductSelect

const detailSelect = {
  ...listSelect,
  description: true,
  skills: {
    orderBy: [{ relevance: 'asc' }, { skill: { name: 'asc' } }],
    select: {
      relevance: true,
      skill: { select: { id: true, name: true, category: true } },
    },
  },
} satisfies Prisma.ITProductSelect

export type ProductListRow = Prisma.ITProductGetPayload<{ select: typeof listSelect }>
export type ProductDetailRow = Prisma.ITProductGetPayload<{ select: typeof detailSelect }>

export async function findMany(
  query: ProductListQuery,
): Promise<{ rows: ProductListRow[]; total: number }> {
  const where: Prisma.ITProductWhereInput = {}
  if (query.category?.length) where.category = { in: query.category }
  if (query.status?.length) where.status = { in: query.status }
  if (query.skillId?.length) where.skills = { some: { skillId: { in: query.skillId } } }
  if (query.q) {
    const contains = { contains: query.q, mode: 'insensitive' as const }
    where.OR = [{ name: contains }, { category: contains }, { description: contains }]
  }

  const { field, direction } = parseSort(query.sort, PRODUCT_SORT_FIELDS, {
    field: 'name',
    direction: 'asc',
  })

  const [rows, total] = await Promise.all([
    prisma.iTProduct.findMany({
      where,
      select: listSelect,
      orderBy: { [field]: direction },
      ...toSkipTake({ page: query.page, pageSize: query.pageSize }),
    }),
    prisma.iTProduct.count({ where }),
  ])
  return { rows, total }
}

export async function findById(id: string): Promise<ProductDetailRow | null> {
  return prisma.iTProduct.findUnique({ where: { id }, select: detailSelect })
}

/** Связки с этим продуктом, которые затрагивает групповая операция, и их этап материалов. */
export async function findReleaseTargets(productId: string, stageNumber: number) {
  return prisma.cooperation.findMany({
    where: { productId, status: { in: [...BULK_TARGET_STATUSES] } },
    select: {
      id: true,
      university: { select: { name: true } },
      program: { select: { name: true } },
      stages: {
        where: { stageNumber },
        select: {
          id: true,
          stageNumber: true,
          status: true,
          tasks: { select: { sortOrder: true } },
        },
      },
    },
  })
}

export interface ReleaseApplyInput {
  productId: string
  version: string
  taskTitle: string
  reopenComment: string
  userId: string
  targets: Array<{ stageId: string; cooperationId: string; reopen: boolean; nextSortOrder: number }>
}

/**
 * Применяет выпуск версии одной транзакцией: обновляет версию продукта, ставит задачи
 * и переоткрывает закрытые этапы. Частично применённая групповая операция хуже,
 * чем неприменённая: менеджер не поймёт, где уже сработало, а где нет.
 */
export async function applyRelease(input: ReleaseApplyInput): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.iTProduct.update({
      where: { id: input.productId },
      data: { version: input.version },
    })

    for (const target of input.targets) {
      await tx.task.create({
        data: {
          stageId: target.stageId,
          title: input.taskTitle,
          isRequired: true,
          sortOrder: target.nextSortOrder,
        },
      })

      if (!target.reopen) continue

      await tx.workflowStage.update({
        where: { id: target.stageId },
        data: { status: 'IN_PROGRESS', completedAt: null, completedById: null },
      })

      await tx.stageHistory.create({
        data: {
          stageId: target.stageId,
          fromStatus: 'COMPLETED',
          toStatus: 'IN_PROGRESS',
          comment: input.reopenComment,
          changedById: input.userId,
        },
      })

      // Контрольный этап 14 зависит от остальных — пересчитываем его здесь же.
      const stages = await tx.workflowStage.findMany({
        where: { cooperationId: target.cooperationId },
        select: { id: true, stageNumber: true, status: true },
      })
      const control = stages.find((stage) => stage.stageNumber === CONTROL_STAGE_NUMBER)
      if (!control) continue

      const next = computeControlStatus(
        stages
          .filter((stage) => stage.stageNumber !== CONTROL_STAGE_NUMBER)
          .map((stage) => stage.status),
      )
      if (next === control.status) continue

      await tx.workflowStage.update({
        where: { id: control.id },
        data: {
          status: next,
          completedAt: next === 'COMPLETED' ? new Date() : null,
          completedById: null,
        },
      })
      await tx.stageHistory.create({
        data: {
          stageId: control.id,
          fromStatus: control.status,
          toStatus: next,
          comment: 'Пересчитано автоматически по состоянию этапов 1–13',
          changedById: input.userId,
        },
      })
    }
  })
}
