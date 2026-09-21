import { notFound } from '@/shared/http/errors'
import { pageMeta } from '@/shared/http/pagination'
import { assertCan } from '@/shared/auth/permissions'
import type { CurrentUser } from '@/shared/auth/current-user'
import type { PageMeta } from '@/shared/contracts/common'
import type { ProductDto, ProductListItemDto } from '@/shared/contracts/product'
import { toIsoRequired } from '@/shared/utils/date'
import * as repo from './products.repo'
import type { ProductListQuery } from './products.schema'

function toListItem(row: repo.ProductListRow): ProductListItemDto {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    version: row.version,
    status: row.status,
    documentationUrl: row.documentationUrl,
    skillCount: row._count.skills,
    cooperationCount: row._count.cooperations,
    isMock: row.isMock,
    updatedAt: toIsoRequired(row.updatedAt),
  }
}

export async function list(
  user: CurrentUser,
  query: ProductListQuery,
): Promise<{ data: ProductListItemDto[]; meta: PageMeta }> {
  assertCan(user, 'READ')
  const { rows, total } = await repo.findMany(query)
  return {
    data: rows.map(toListItem),
    meta: pageMeta({ page: query.page, pageSize: query.pageSize }, total),
  }
}

export async function getById(user: CurrentUser, id: string): Promise<ProductDto> {
  assertCan(user, 'READ')
  const row = await repo.findById(id)
  if (!row) throw notFound('IT-продукт не найден')
  return {
    ...toListItem(row),
    description: row.description,
    skills: row.skills.map((item) => ({
      skillId: item.skill.id,
      name: item.skill.name,
      category: item.skill.category,
      relevance: item.relevance,
    })),
    createdAt: toIsoRequired(row.createdAt),
  }
}
