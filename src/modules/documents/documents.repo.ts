import { prisma } from '@/shared/db/prisma'
import { textContains } from '@/shared/db/text-search'
import { buildOrderBy, parseSort, toSkipTake } from '@/shared/http/pagination'
import { intersectUniversityFilter } from '@/shared/auth/scope'
import { conflict } from '@/shared/http/errors'
import type { Prisma } from '@/generated/prisma/client'
import { DOCUMENT_SORT_FIELDS, type DocumentListQuery } from './documents.schema'
import { LIVE_CONTACT_WHERE } from '@/modules/universities/universities.rules'

const userRefSelect = { id: true, fullName: true, role: true } satisfies Prisma.UserSelect

const listSelect = {
  id: true,
  type: true,
  title: true,
  version: true,
  status: true,
  content: true,
  templateKey: true,
  fileReference: true,
  issuedAt: true,
  signedAt: true,
  cooperationId: true,
  universityId: true,
  programId: true,
  createdAt: true,
  updatedAt: true,
  author: { select: userRefSelect },
  responsible: { select: userRefSelect },
  university: { select: { id: true, name: true, shortName: true } },
  program: { select: { id: true, name: true } },
} satisfies Prisma.DocumentSelect

const detailSelect = {
  ...listSelect,
  history: {
    orderBy: { changedAt: 'desc' },
    select: {
      id: true,
      fromStatus: true,
      toStatus: true,
      comment: true,
      changedAt: true,
      changedBy: { select: userRefSelect },
    },
  },
} satisfies Prisma.DocumentSelect

type DocumentStatusValue = 'DRAFT' | 'REVIEW' | 'APPROVED' | 'SIGNED' | 'REJECTED' | 'ARCHIVED'

export type DocumentListRow = Prisma.DocumentGetPayload<{ select: typeof listSelect }>
export type DocumentDetailRow = Prisma.DocumentGetPayload<{ select: typeof detailSelect }>

/**
 * Представитель вуза видит только документы своего вуза — напрямую или через связку.
 * Один хелпер вместо проверок в каждом маршруте: новый путь к документам его не забудет.
 */
function scopeFilter(scope: { universityId?: string }): Prisma.DocumentWhereInput {
  if (!scope.universityId) return {}
  return {
    OR: [
      { universityId: scope.universityId },
      { cooperation: { universityId: scope.universityId } },
      { program: { universityId: scope.universityId } },
    ],
  }
}

export async function findMany(
  query: DocumentListQuery,
  scope: { universityId?: string },
): Promise<{ rows: DocumentListRow[]; total: number }> {
  // Запрошен вуз вне области видимости — выборка пуста, а не «свои записи вместо чужих».
  const universityFilter = intersectUniversityFilter(scope, query.universityId)
  if (universityFilter === null) return { rows: [], total: 0 }

  const where: Prisma.DocumentWhereInput = { ...scopeFilter(scope) }

  if (query.cooperationId) where.cooperationId = query.cooperationId
  if (query.universityId) where.universityId = query.universityId
  if (query.programId) where.programId = query.programId
  if (query.type?.length) where.type = { in: query.type }
  if (query.status?.length) where.status = { in: query.status }
  if (query.q) where.title = textContains(query.q)

  const { field, direction } = parseSort(query.sort, DOCUMENT_SORT_FIELDS, {
    field: 'updatedAt',
    direction: 'desc',
  })

  const [rows, total] = await Promise.all([
    prisma.document.findMany({
      where,
      select: listSelect,
      orderBy: buildOrderBy({ field, direction }),
      ...toSkipTake({ page: query.page, pageSize: query.pageSize }),
    }),
    prisma.document.count({ where }),
  ])
  return { rows, total }
}

export async function findById(
  id: string,
  scope: { universityId?: string },
): Promise<DocumentDetailRow | null> {
  return prisma.document.findFirst({
    where: { id, ...scopeFilter(scope) },
    select: detailSelect,
  })
}

export async function create(
  data: Prisma.DocumentCreateInput,
  client: Prisma.TransactionClient = prisma,
): Promise<DocumentDetailRow> {
  return client.document.create({ data, select: detailSelect })
}

/**
 * Правка полей — только если статус всё ещё тот, по которому её разрешили.
 *
 * Проверка «можно ли править» и запись идут порознь: без условия подпись между ними
 * дала бы правку уже подписанного документа, хотя подписанный правкам не подлежит.
 */
export async function update(
  id: string,
  expectedStatus: DocumentStatusValue,
  data: Prisma.DocumentUncheckedUpdateManyInput,
): Promise<DocumentDetailRow> {
  const changed = await prisma.document.updateMany({
    where: { id, status: expectedStatus },
    data,
  })
  if (changed.count === 0) {
    throw conflict('Документ уже изменён другим пользователем. Обновите страницу и повторите действие.')
  }
  const row = await prisma.document.findUnique({ where: { id }, select: detailSelect })
  if (!row) throw conflict('Документ удалён другим пользователем')
  return row
}

/**
 * Новая версия документа: исходная уходит в архив, новая создаётся — одной транзакцией.
 *
 * Исходная сначала переводится в архив условно (статус тот, что прочитан), и только
 * потом создаётся новая: второй запрос двойного щелчка получает отказ до того, как
 * что-либо создаст. В обратном порядке он успел бы положить в базу вторую «версию 2»
 * и получить отказ только на архивации.
 */
export async function createVersion(
  sourceId: string,
  sourceStatus: DocumentStatusValue,
  data: Prisma.DocumentCreateInput,
  userId: string,
): Promise<DocumentDetailRow> {
  return prisma.$transaction(async (tx) => {
    const claimed = await tx.document.updateMany({
      where: { id: sourceId, status: sourceStatus },
      data: { status: 'ARCHIVED' },
    })
    if (claimed.count === 0) {
      throw conflict('Документ уже изменён другим пользователем. Обновите страницу и повторите действие.')
    }
    const created = await tx.document.create({ data, select: detailSelect })
    await tx.documentHistory.create({
      data: {
        documentId: sourceId,
        fromStatus: sourceStatus,
        toStatus: 'ARCHIVED',
        comment: `Заменён версией ${created.version}`,
        changedById: userId,
      },
    })
    return created
  })
}

/** Смена статуса и запись в историю — одной транзакцией. */
export async function changeStatus(
  id: string,
  fromStatus: DocumentStatusValue,
  toStatus: DocumentStatusValue,
  comment: string | null,
  userId: string,
): Promise<DocumentDetailRow> {
  return prisma.$transaction(async (tx) => {
    // Условное обновление: защищает от двойного клика, который иначе записал бы
    // в историю документа два одинаковых перехода.
    const changed = await tx.document.updateMany({
      where: { id, status: fromStatus as DocumentStatusValue },
      data: {
        status: toStatus,
        // Факт и дата подписания фиксируются системой: электронной подписи нет (концепция).
        ...(toStatus === 'SIGNED' ? { signedAt: new Date() } : {}),
      },
    })

    if (changed.count === 0) {
      throw conflict(
        'Документ уже изменён другим пользователем. Обновите страницу и повторите действие.',
      )
    }

    await tx.documentHistory.create({
      data: {
        documentId: id,
        fromStatus,
        toStatus,
        comment,
        changedById: userId,
      },
    })

    const row = await tx.document.findUnique({ where: { id }, select: detailSelect })
    if (!row) throw new Error('Документ исчез внутри транзакции')
    return row
  })
}

/**
 * Действующие документы связки, с которыми сверяется пакет: пакет не пересобирается вслепую.
 * Свежие первыми — в причине пропуска называется последний документ.
 */
export async function findPackageDocuments(
  cooperationId: string,
  client: Prisma.TransactionClient = prisma,
) {
  return client.document.findMany({
    where: { cooperationId, status: { not: 'ARCHIVED' } },
    orderBy: { createdAt: 'desc' },
    select: { title: true, type: true, status: true, templateKey: true },
  })
}

/** Реквизиты для подстановки в шаблоны: всё одним запросом. */
export async function loadTemplateContextSource(cooperationId: string) {
  return prisma.cooperation.findUnique({
    where: { id: cooperationId },
    select: {
      id: true,
      goal: true,
      status: true,
      universityId: true,
      programId: true,
      university: {
        select: {
          name: true,
          shortName: true,
          city: true,
          address: true,
          website: true,
          contacts: {
            // Обезличенный контакт в новый документ не подставляется: «в лице Контакт удалён».
            where: LIVE_CONTACT_WHERE,
            orderBy: [{ isPrimary: 'desc' }, { fullName: 'asc' }],
            take: 1,
            select: { fullName: true, position: true },
          },
        },
      },
      program: { select: { name: true, level: true, code: true } },
      product: { select: { name: true, version: true } },
      responsible: { select: { id: true, fullName: true, position: true } },
    },
  })
}
