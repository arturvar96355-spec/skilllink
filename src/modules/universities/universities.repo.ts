import { prisma } from '@/shared/db/prisma'
import { ACTIVE_COOPERATION_STATUSES } from '@/shared/contracts/enums'
import { textContains } from '@/shared/db/text-search'
import { buildOrderBy, toSkipTake, parseSort, TIE_BREAKER, type Pagination } from '@/shared/http/pagination'
import type { Prisma } from '@/generated/prisma/client'
import { UNIVERSITY_SORT_FIELDS, type UniversityListQuery } from './universities.schema'
import type { ContactBasisPlan, ContactForBasis } from './universities.rules'

/**
 * Поля учёта основания обработки ПД (решение 111). Выбираются везде, где контакт
 * уходит наружу: без них карточка показала бы «не зафиксировано» там, где оно есть.
 */
const contactBasisSelect = {
  legalBasis: true,
  consentStatus: true,
  consentObtainedAt: true,
  consentForm: true,
  consentWithdrawnAt: true,
  basisReference: true,
  withdrawalReference: true,
  basisUpdatedAt: true,
} satisfies Prisma.ContactSelect

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
      ...contactBasisSelect,
    },
  },
} satisfies Prisma.UniversitySelect

export type UniversityListRow = Prisma.UniversityGetPayload<{ select: typeof listSelect }>
export type UniversityDetailRow = Prisma.UniversityGetPayload<{ select: typeof detailSelect }>

/**
 * Собирает where по фильтрам списка.
 * `scope` приходит из общего хелпера ограничения по вузу (`universityScope`) —
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
    const contains = textContains(query.q)
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
    where: {
      universityId: { in: universityIds },
      status: { in: [...ACTIVE_COOPERATION_STATUSES] },
    },
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

const contactSelect = {
  id: true,
  universityId: true,
  fullName: true,
  position: true,
  email: true,
  phone: true,
  isPrimary: true,
  ...contactBasisSelect,
} satisfies Prisma.ContactSelect

export type ContactRow = Prisma.ContactGetPayload<{ select: typeof contactSelect }>

/** Контакт именно этого вуза: чужой идентификатор в адресе — null, а не запись другого вуза. */
export async function findContact(universityId: string, contactId: string): Promise<ContactRow | null> {
  return prisma.contact.findFirst({ where: { id: contactId, universityId }, select: contactSelect })
}

export async function updateContact(
  contactId: string,
  data: Prisma.ContactUpdateInput,
): Promise<ContactRow> {
  return prisma.contact.update({ where: { id: contactId }, data, select: contactSelect })
}

/**
 * Изменить основание или согласие контакта одной транзакцией: строка контакта
 * блокируется (`FOR UPDATE`), состояние перечитывается под блокировкой, план
 * строится правилом по нему. Два одновременных отзыва или «зафиксировать» и
 * «отозвать» наперегонки не запишут две истории от одного и того же «было».
 *
 * null — контакта у этого вуза нет. `changed: false` — правило сказало «ничего
 * не меняется» (повтор).
 */
export async function changeContactBasis(
  universityId: string,
  contactId: string,
  changedById: string,
  plan: (current: ContactForBasis) => ContactBasisPlan | null,
): Promise<{ before: ContactRow; after: ContactRow; changed: boolean } | null> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM contacts WHERE id = ${contactId} AND university_id = ${universityId} FOR UPDATE`
    const before = await tx.contact.findFirst({
      where: { id: contactId, universityId },
      select: contactSelect,
    })
    if (!before) return null

    const next = plan(before)
    if (!next) return { before, after: before, changed: false }

    const after = await tx.contact.update({
      where: { id: contactId },
      data: next.data,
      select: contactSelect,
    })
    await tx.contactBasisHistory.create({
      data: { ...next.history, contactId, changedById, changedAt: next.data.basisUpdatedAt },
    })
    return { before, after, changed: true }
  })
}

const basisHistorySelect = {
  id: true,
  fromBasis: true,
  toBasis: true,
  fromConsentStatus: true,
  toConsentStatus: true,
  consentObtainedAt: true,
  consentForm: true,
  consentWithdrawnAt: true,
  referenceChanged: true,
  anonymized: true,
  changedAt: true,
  changedBy: { select: { id: true, fullName: true, role: true } },
} satisfies Prisma.ContactBasisHistorySelect

export type ContactBasisHistoryRow = Prisma.ContactBasisHistoryGetPayload<{
  select: typeof basisHistorySelect
}>

/** История основания контакта, новые записи сверху. */
export async function findBasisHistory(
  contactId: string,
  pagination: Pagination,
): Promise<{ rows: ContactBasisHistoryRow[]; total: number }> {
  const where = { contactId }
  const [rows, total] = await Promise.all([
    prisma.contactBasisHistory.findMany({
      where,
      select: basisHistorySelect,
      orderBy: [{ changedAt: 'desc' }, TIE_BREAKER],
      ...toSkipTake(pagination),
    }),
    prisma.contactBasisHistory.count({ where }),
  ])
  return { rows, total }
}
