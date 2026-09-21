import { prisma } from '@/shared/db/prisma'
import { buildOrderBy, parseSort, toSkipTake } from '@/shared/http/pagination'
import type { Prisma } from '@/generated/prisma/client'
import { DOCUMENT_SORT_FIELDS, type DocumentListQuery } from './documents.schema'

const userRefSelect = { id: true, fullName: true, role: true } satisfies Prisma.UserSelect

const listSelect = {
  id: true,
  type: true,
  title: true,
  version: true,
  status: true,
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
  university: { select: { id: true, name: true } },
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
  const where: Prisma.DocumentWhereInput = { ...scopeFilter(scope) }

  if (query.cooperationId) where.cooperationId = query.cooperationId
  if (query.universityId && !scope.universityId) where.universityId = query.universityId
  if (query.programId) where.programId = query.programId
  if (query.type?.length) where.type = { in: query.type }
  if (query.status?.length) where.status = { in: query.status }
  if (query.q) where.title = { contains: query.q, mode: 'insensitive' }

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

export async function create(data: Prisma.DocumentCreateInput): Promise<DocumentDetailRow> {
  return prisma.document.create({ data, select: detailSelect })
}

export async function update(
  id: string,
  data: Prisma.DocumentUpdateInput,
): Promise<DocumentDetailRow> {
  return prisma.document.update({ where: { id }, data, select: detailSelect })
}

/** Смена статуса и запись в историю — одной транзакцией. */
export async function changeStatus(
  id: string,
  fromStatus: Prisma.DocumentUpdateInput['status'],
  toStatus: 'DRAFT' | 'REVIEW' | 'APPROVED' | 'SIGNED' | 'REJECTED' | 'ARCHIVED',
  comment: string | null,
  userId: string,
): Promise<DocumentDetailRow> {
  return prisma.$transaction(async (tx) => {
    await tx.document.update({
      where: { id },
      data: {
        status: toStatus,
        // Факт и дата подписания фиксируются системой: электронной подписи нет (концепция).
        ...(toStatus === 'SIGNED' ? { signedAt: new Date() } : {}),
      },
    })

    await tx.documentHistory.create({
      data: {
        documentId: id,
        fromStatus: fromStatus as 'DRAFT' | 'REVIEW' | 'APPROVED' | 'SIGNED' | 'REJECTED' | 'ARCHIVED',
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
