import { prisma } from '@/shared/db/prisma'
import { buildOrderBy, toSkipTake, parseSort, type Pagination } from '@/shared/http/pagination'
import type { Prisma } from '@/generated/prisma/client'
import { UNIVERSITY_SORT_FIELDS, type UniversityListQuery } from './universities.schema'

/** Поля, которые нужны и списку, и карточке. Считаем программы и связи одним запросом. */
const listSelect = {
  id: true,
  name: true,
  shortName: true,
  city: true,
  region: true,
  status: true,
  isMock: true,
  createdAt: true,
  updatedAt: true,
  archivedAt: true,
  _count: { select: { programs: true, cooperations: true } },
} satisfies Prisma.UniversitySelect

const detailSelect = {
  ...listSelect,
  address: true,
  website: true,
  description: true,
  directionCount: true,
  studentCount: true,
  contacts: {
    orderBy: [{ isPrimary: 'desc' }, { fullName: 'asc' }],
    select: {
      id: true,
      fullName: true,
      position: true,
      email: true,
      phone: true,
      isPrimary: true,
    },
  },
} satisfies Prisma.UniversitySelect

export type UniversityListRow = Prisma.UniversityGetPayload<{ select: typeof listSelect }>
export type UniversityDetailRow = Prisma.UniversityGetPayload<{ select: typeof detailSelect }>

/**
 * Собирает where по фильтрам списка.
 * `scope` приходит из общего хелпера ограничения по вузу (решение 10) —
 * для представителя вуза он сужает выборку до его собственной записи.
 */
export function buildWhere(
  query: UniversityListQuery,
  scope: { universityId?: string },
  restrictToIds?: readonly string[],
): Prisma.UniversityWhereInput {
  const where: Prisma.UniversityWhereInput = {}

  if (scope.universityId) where.id = scope.universityId
  // Отбор по рейтингу считается в приложении и приходит сюда готовым списком.
  // Пересечение с ограничением области видимости, а не замена: иначе представитель
  // вуза увидел бы чужие записи.
  if (restrictToIds) {
    where.id = scope.universityId
      ? restrictToIds.includes(scope.universityId)
        ? scope.universityId
        : { in: [] }
      : { in: [...restrictToIds] }
  }
  if (query.status?.length) where.status = { in: query.status }
  if (query.region?.length) where.region = { in: query.region }
  if (query.city?.length) where.city = { in: query.city }
  if (!query.includeArchived) where.archivedAt = null

  if (query.q) {
    const contains = { contains: query.q, mode: 'insensitive' as const }
    where.OR = [
      { name: contains },
      { shortName: contains },
      { city: contains },
      { region: contains },
      { programs: { some: { name: contains } } },
    ]
  }

  return where
}

export async function findMany(
  query: UniversityListQuery,
  scope: { universityId?: string },
  restrictToIds?: readonly string[],
): Promise<{ rows: UniversityListRow[]; total: number }> {
  const where = buildWhere(query, scope, restrictToIds)
  const pagination: Pagination = { page: query.page, pageSize: query.pageSize }
  const { field, direction } = parseSort(query.sort, UNIVERSITY_SORT_FIELDS, {
    field: 'name',
    direction: 'asc',
  })

  const [rows, total] = await Promise.all([
    prisma.university.findMany({
      where,
      select: listSelect,
      orderBy: buildOrderBy({ field, direction }),
      ...toSkipTake(pagination),
    }),
    prisma.university.count({ where }),
  ])

  return { rows, total }
}

/**
 * Идентификаторы всех вузов, подходящих под фильтры, без страницы.
 * Нужны для сортировки по рейтингу: рейтинг считается в приложении,
 * поэтому страницу нельзя взять средствами SQL.
 */
export async function findIds(
  query: UniversityListQuery,
  scope: { universityId?: string },
  restrictToIds?: readonly string[],
): Promise<string[]> {
  const rows = await prisma.university.findMany({
    where: buildWhere(query, scope, restrictToIds),
    select: { id: true },
  })
  return rows.map((row) => row.id)
}

/** Строки списка по готовому набору идентификаторов. Порядок восстанавливает сервис. */
export async function findByIds(ids: readonly string[]): Promise<UniversityListRow[]> {
  if (ids.length === 0) return []
  return prisma.university.findMany({ where: { id: { in: [...ids] } }, select: listSelect })
}

export async function findById(
  id: string,
  scope: { universityId?: string },
): Promise<UniversityDetailRow | null> {
  // Представителю вуза видна только его собственная запись. Чужой идентификатор —
  // это null, который сервис превращает в NOT_FOUND: существование записи не раскрывается.
  if (scope.universityId && scope.universityId !== id) return null

  return prisma.university.findUnique({ where: { id }, select: detailSelect })
}

/** Количество активных связей по каждому вузу. Отдельный запрос: _count не умеет фильтровать так. */
export async function countActiveCooperations(
  universityIds: string[],
): Promise<Map<string, number>> {
  if (universityIds.length === 0) return new Map()
  const rows = await prisma.cooperation.groupBy({
    by: ['universityId'],
    where: { universityId: { in: universityIds }, status: { in: ['ACTIVE', 'DRAFT', 'PAUSED'] } },
    _count: { _all: true },
  })
  return new Map(rows.map((row) => [row.universityId, row._count._all]))
}

export async function create(
  data: Prisma.UniversityCreateInput,
): Promise<UniversityDetailRow> {
  return prisma.university.create({ data, select: detailSelect })
}

export async function update(
  id: string,
  data: Prisma.UniversityUpdateInput,
): Promise<UniversityDetailRow> {
  return prisma.university.update({ where: { id }, data, select: detailSelect })
}

export async function exists(id: string): Promise<boolean> {
  const found = await prisma.university.findUnique({ where: { id }, select: { id: true } })
  return found !== null
}
