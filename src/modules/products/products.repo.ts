import { prisma } from '@/shared/db/prisma'
import { parseSort, toSkipTake } from '@/shared/http/pagination'
import type { Prisma } from '@/generated/prisma/client'
import { PRODUCT_SORT_FIELDS, type ProductListQuery } from './products.schema'

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
