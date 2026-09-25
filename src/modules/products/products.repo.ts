import { prisma } from '@/shared/db/prisma'
import { textContains } from '@/shared/db/text-search'
import { buildOrderBy, parseSort, toSkipTake } from '@/shared/http/pagination'
import type { Prisma } from '@/generated/prisma/client'
import {
  lockCooperation,
  recomputeControlStage,
  type ControlStageChange,
} from '@/modules/workflow/workflow.repo'
import { PRODUCT_SORT_FIELDS, type ProductListQuery } from './products.schema'
import { BULK_TARGET_STATUSES, duplicateNameConflict } from './products.rules'

/** Кому считаются связки продукта: представителю вуза — только его вуз. */
export type ProductScope = { universityId?: string }

/**
 * Число связок продукта — в пределах видимости.
 *
 * Счётчик по всей базе раскрыл бы представителю вуза, сколько связок у продукта
 * с другими вузами, а другие вузы ему не видны: «Конвейер сборки и поставки —
 * 2 связки» при одной своей.
 */
const scopedCounts = (scope: ProductScope) => ({
  select: {
    skills: true,
    cooperations: scope.universityId ? { where: { universityId: scope.universityId } } : true,
  },
})

const listSelect = (scope: ProductScope) =>
  ({
    id: true,
    name: true,
    category: true,
    version: true,
    status: true,
    documentationUrl: true,
    isMock: true,
    createdAt: true,
    updatedAt: true,
    _count: scopedCounts(scope),
  }) satisfies Prisma.ITProductSelect

const detailSelect = (scope: ProductScope) =>
  ({
    ...listSelect(scope),
    description: true,
    skills: {
      orderBy: [{ relevance: 'asc' }, { skill: { name: 'asc' } }],
      select: {
        relevance: true,
        skill: { select: { id: true, name: true, category: true } },
      },
    },
  }) satisfies Prisma.ITProductSelect

export type ProductListRow = Prisma.ITProductGetPayload<{ select: ReturnType<typeof listSelect> }>
export type ProductDetailRow = Prisma.ITProductGetPayload<{
  select: ReturnType<typeof detailSelect>
}>

export async function findMany(
  query: ProductListQuery,
  scope: ProductScope,
): Promise<{ rows: ProductListRow[]; total: number }> {
  const where: Prisma.ITProductWhereInput = {}
  if (query.category?.length) where.category = { in: query.category }
  if (query.status?.length) where.status = { in: query.status }
  if (query.skillId?.length) where.skills = { some: { skillId: { in: query.skillId } } }
  if (query.q) {
    const contains = textContains(query.q)
    where.OR = [{ name: contains }, { category: contains }, { description: contains }]
  }

  const { field, direction } = parseSort(query.sort, PRODUCT_SORT_FIELDS, {
    field: 'name',
    direction: 'asc',
  })

  const [rows, total] = await Promise.all([
    prisma.iTProduct.findMany({
      where,
      select: listSelect(scope),
      orderBy: buildOrderBy({ field, direction }),
      ...toSkipTake({ page: query.page, pageSize: query.pageSize }),
    }),
    prisma.iTProduct.count({ where }),
  ])
  return { rows, total }
}

export async function findById(id: string, scope: ProductScope): Promise<ProductDetailRow | null> {
  return prisma.iTProduct.findUnique({ where: { id }, select: detailSelect(scope) })
}

/**
 * Продукт с таким же названием без учёта регистра — для понятного отказа на дубль.
 * `excludeId` — сам изменяемый продукт: сохранить своё же название не дубль.
 */
export async function findByNameInsensitive(
  name: string,
  excludeId?: string,
): Promise<{ id: string; name: string } | null> {
  return prisma.iTProduct.findFirst({
    where: {
      name: { equals: name, mode: 'insensitive' },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true, name: true },
  })
}

/** P2002 — нарушение уникального ограничения: то же название успел сохранить параллельный запрос. */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'P2002'
  )
}

/**
 * Проверка названия в сервисе и запись — два запроса: между ними то же название
 * может сохранить другой человек. Тогда сработает ограничение базы, и ответ
 * должен быть тем же понятным 409, а не общим «запись уже существует: name».
 */
async function withNameGuard<T>(name: string | undefined, action: () => Promise<T>): Promise<T> {
  try {
    return await action()
  } catch (error) {
    if (name !== undefined && isUniqueViolation(error)) throw duplicateNameConflict(name)
    throw error
  }
}

export async function create(data: Prisma.ITProductCreateInput): Promise<ProductDetailRow> {
  return withNameGuard(data.name, () =>
    prisma.iTProduct.create({ data, select: detailSelect({}) }),
  )
}

export async function update(
  id: string,
  data: Prisma.ITProductUpdateInput & { name?: string },
): Promise<ProductDetailRow> {
  return withNameGuard(data.name, () =>
    prisma.iTProduct.update({ where: { id }, data, select: detailSelect({}) }),
  )
}

/** Связки продукта, которым новая версия ещё нужна: закрытые и отменённые не считаются. */
export async function countOpenCooperations(productId: string): Promise<number> {
  return prisma.cooperation.count({
    where: { productId, status: { in: [...BULK_TARGET_STATUSES] } },
  })
}

/** Какие из переданных навыков существуют. */
export async function findExistingSkillIds(ids: string[]): Promise<string[]> {
  if (ids.length === 0) return []
  const rows = await prisma.skill.findMany({ where: { id: { in: ids } }, select: { id: true } })
  return rows.map((row) => row.id)
}

/** Заменяет набор навыков продукта одной транзакцией. */
export async function replaceSkills(
  productId: string,
  skills: Array<{ skillId: string; relevance: 'CORE' | 'RELATED' | 'OPTIONAL' }>,
): Promise<void> {
  await prisma.$transaction([
    prisma.productSkill.deleteMany({ where: { productId } }),
    ...(skills.length > 0
      ? [
          prisma.productSkill.createMany({
            data: skills.map((skill) => ({
              productId,
              skillId: skill.skillId,
              relevance: skill.relevance,
            })),
          }),
        ]
      : []),
  ])
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
export async function applyRelease(input: ReleaseApplyInput): Promise<ControlStageChange[]> {
  return prisma.$transaction(async (tx) => {
    const controlChanges: ControlStageChange[] = []
    // Та же очередь, что у смены статусов (workflow.repo.lockCooperation). По порядку id,
    // чтобы два выпуска с общими связками не ждали друг друга по кругу.
    const cooperationIds = [...new Set(input.targets.map((target) => target.cooperationId))].sort()
    for (const cooperationId of cooperationIds) await lockCooperation(tx, cooperationId)

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

      // Контрольный этап 14 зависит от остальных — тот же пересчёт, что при смене статуса.
      const change = await recomputeControlStage(tx, target.cooperationId, input.userId)
      if (change) controlChanges.push(change)
    }
    return controlChanges
  })
}
