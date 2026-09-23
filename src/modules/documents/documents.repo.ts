import { prisma } from '@/shared/db/prisma'
import { textContains } from '@/shared/db/text-search'
import { buildOrderBy, parseSort, toSkipTake } from '@/shared/http/pagination'
import { intersectUniversityFilter } from '@/shared/auth/scope'
import { conflict } from '@/shared/http/errors'
import type { Prisma } from '@/generated/prisma/client'
import { DOCUMENT_SORT_FIELDS, type DocumentListQuery } from './documents.schema'

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
 * Один хелпер вместо проверок в каждом маршруте (решение 10).
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
 * Проверка «можно ли править» и запись шли порознь: подпись между ними давала
 * правку уже подписанного документа, хотя подписанный правкам не подлежит.
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
 * Раньше сначала создавалась новая версия, потом архивировалась исходная, без
 * транзакции. Двойной щелчок давал две «версии 2»: второй запрос создавал свою
 * и только на архивации получал отказ — а версия уже лежала в базе. Теперь исходная
 * сначала переводится в архив условно (статус тот, что прочитан), и второй запрос
 * получает отказ до того, как что-либо создаст.
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

/** Ключи шаблонов, по которым в связке уже есть документы: пакет не пересобирается вслепую. */
export async function findTemplateKeys(
  cooperationId: string,
  client: Prisma.TransactionClient = prisma,
): Promise<Set<string>> {
  const rows = await client.document.findMany({
    where: { cooperationId, templateKey: { not: null } },
    select: { templateKey: true },
  })
  return new Set(rows.map((row) => row.templateKey).filter((key): key is string => key !== null))
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
