import { z } from '@/shared/zod'
import type { PageMeta } from './response'

export const DEFAULT_PAGE_SIZE = 20
export const MAX_PAGE_SIZE = 100

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
})

export type Pagination = z.infer<typeof paginationSchema>

export function toSkipTake({ page, pageSize }: Pagination): { skip: number; take: number } {
  return { skip: (page - 1) * pageSize, take: pageSize }
}

export function pageMeta(pagination: Pagination, total: number): PageMeta {
  return { page: pagination.page, pageSize: pagination.pageSize, total }
}

/** Разбирает `sort=-createdAt` в { field: 'createdAt', direction: 'desc' }. */
export function parseSort<F extends string>(
  raw: string | undefined,
  allowed: readonly F[],
  fallback: { field: F; direction: 'asc' | 'desc' },
): { field: F; direction: 'asc' | 'desc' } {
  if (!raw) return fallback
  const direction = raw.startsWith('-') ? 'desc' : 'asc'
  const field = (raw.startsWith('-') || raw.startsWith('+') ? raw.slice(1) : raw) as F
  return allowed.includes(field) ? { field, direction } : fallback
}

/**
 * Последний ключ сортировки любого списка, который отдаётся по страницам.
 *
 * Без него строки с равным значением — программы одного уровня, связки одного
 * статуса — база возвращает в произвольном порядке, и соседние страницы
 * повторяют одни строки и теряют другие. Пробник поймал это на ленте
 * рекомендаций: 28 строк по страницам, из них 25 разных.
 */
export const TIE_BREAKER = { id: 'asc' } as const

/**
 * Строит orderBy для Prisma: выбранное поле, затем `then`, затем id.
 * `nulls: 'last'` допустим только у nullable-полей — иначе Prisma отклоняет запрос,
 * поэтому список таких полей задаёт вызывающий репозиторий.
 */
export function buildOrderBy<F extends string>(
  sort: { field: F; direction: 'asc' | 'desc' },
  nullableFields: readonly F[] = [],
  then: ReadonlyArray<Record<string, 'asc' | 'desc'>> = [],
): Array<Record<string, unknown>> {
  return [
    {
      [sort.field]: nullableFields.includes(sort.field)
        ? { sort: sort.direction, nulls: 'last' }
        : sort.direction,
    },
    ...then,
    TIE_BREAKER,
  ]
}
