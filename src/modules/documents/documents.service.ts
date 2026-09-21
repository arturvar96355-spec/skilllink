import { prisma } from '@/shared/db/prisma'
import { notFound, validationError } from '@/shared/http/errors'
import { pageMeta } from '@/shared/http/pagination'
import { assertCan, isUniversityVisible, universityScope } from '@/shared/auth/permissions'
import { writeAudit } from '@/shared/audit/audit'
import type { CurrentUser } from '@/shared/auth/current-user'
import type { PageMeta } from '@/shared/contracts/common'
import type {
  DocumentDto,
  DocumentLinksDto,
  DocumentListItemDto,
} from '@/shared/contracts/document'
import { toIso, toIsoRequired } from '@/shared/utils/date'
import * as repo from './documents.repo'
import {
  assertDocumentEditable,
  assertDocumentTransition,
  assertHasLink,
  nextVersion,
} from './documents.rules'
import type {
  ChangeDocumentStatusInput,
  CreateDocumentInput,
  DocumentListQuery,
  UpdateDocumentInput,
} from './documents.schema'

function toLinks(row: repo.DocumentListRow): DocumentLinksDto {
  return {
    cooperationId: row.cooperationId,
    universityId: row.universityId,
    universityName: row.university?.name ?? null,
    programId: row.programId,
    programName: row.program?.name ?? null,
  }
}

function toListItem(row: repo.DocumentListRow): DocumentListItemDto {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    version: row.version,
    status: row.status,
    fileReference: row.fileReference,
    author: row.author,
    responsible: row.responsible,
    issuedAt: toIso(row.issuedAt),
    signedAt: toIso(row.signedAt),
    links: toLinks(row),
    createdAt: toIsoRequired(row.createdAt),
    updatedAt: toIsoRequired(row.updatedAt),
  }
}

function toDetail(row: repo.DocumentDetailRow): DocumentDto {
  return {
    ...toListItem(row),
    history: row.history.map((entry) => ({
      id: entry.id,
      fromStatus: entry.fromStatus,
      toStatus: entry.toStatus,
      comment: entry.comment,
      changedBy: entry.changedBy,
      changedAt: toIsoRequired(entry.changedAt),
    })),
  }
}

/**
 * Проверяет, что все переданные привязки существуют и видны пользователю.
 * Без этого документ можно было бы привязать к чужому вузу.
 */
async function assertLinksVisible(
  user: CurrentUser,
  links: { cooperationId?: string | null; universityId?: string | null; programId?: string | null },
): Promise<void> {
  if (links.cooperationId) {
    const cooperation = await prisma.cooperation.findUnique({
      where: { id: links.cooperationId },
      select: { universityId: true },
    })
    if (!cooperation || !isUniversityVisible(user, cooperation.universityId)) {
      throw validationError('Указана несуществующая связка', [
        { field: 'cooperationId', message: 'Связка не найдена' },
      ])
    }
  }

  if (links.universityId) {
    const university = await prisma.university.findUnique({
      where: { id: links.universityId },
      select: { id: true },
    })
    if (!university || !isUniversityVisible(user, links.universityId)) {
      throw validationError('Указан несуществующий вуз', [
        { field: 'universityId', message: 'Вуз не найден' },
      ])
    }
  }

  if (links.programId) {
    const program = await prisma.educationalProgram.findUnique({
      where: { id: links.programId },
      select: { universityId: true },
    })
    if (!program || !isUniversityVisible(user, program.universityId)) {
      throw validationError('Указана несуществующая программа', [
        { field: 'programId', message: 'Программа не найдена' },
      ])
    }
  }
}

export async function list(
  user: CurrentUser,
  query: DocumentListQuery,
): Promise<{ data: DocumentListItemDto[]; meta: PageMeta }> {
  assertCan(user, 'READ')
  const { rows, total } = await repo.findMany(query, universityScope(user))
  return {
    data: rows.map(toListItem),
    meta: pageMeta({ page: query.page, pageSize: query.pageSize }, total),
  }
}

export async function getById(user: CurrentUser, id: string): Promise<DocumentDto> {
  assertCan(user, 'READ')
  const row = await repo.findById(id, universityScope(user))
  if (!row) throw notFound('Документ не найден')
  return toDetail(row)
}

export async function create(
  user: CurrentUser,
  input: CreateDocumentInput,
): Promise<DocumentDto> {
  assertCan(user, 'WRITE')
  assertHasLink(input)
  await assertLinksVisible(user, input)

  const row = await repo.create({
    type: input.type,
    title: input.title,
    version: input.version,
    fileReference: input.fileReference ?? null,
    issuedAt: input.issuedAt ? new Date(input.issuedAt) : null,
    author: { connect: { id: user.id } },
    ...(input.responsibleId ? { responsible: { connect: { id: input.responsibleId } } } : {}),
    ...(input.cooperationId ? { cooperation: { connect: { id: input.cooperationId } } } : {}),
    ...(input.universityId ? { university: { connect: { id: input.universityId } } } : {}),
    ...(input.programId ? { program: { connect: { id: input.programId } } } : {}),
  })

  await writeAudit({
    userId: user.id,
    action: 'document.create',
    objectType: 'Document',
    objectId: row.id,
    payload: { type: input.type, cooperationId: input.cooperationId ?? null },
  })

  return toDetail(row)
}

export async function update(
  user: CurrentUser,
  id: string,
  input: UpdateDocumentInput,
): Promise<DocumentDto> {
  assertCan(user, 'WRITE')

  const existing = await repo.findById(id, universityScope(user))
  if (!existing) throw notFound('Документ не найден')
  assertDocumentEditable(existing.status)

  const row = await repo.update(id, {
    ...(input.type !== undefined ? { type: input.type } : {}),
    ...(input.title !== undefined ? { title: input.title } : {}),
    ...(input.version !== undefined ? { version: input.version } : {}),
    ...(input.fileReference !== undefined ? { fileReference: input.fileReference } : {}),
    ...(input.issuedAt !== undefined
      ? { issuedAt: input.issuedAt ? new Date(input.issuedAt) : null }
      : {}),
    ...(input.responsibleId !== undefined
      ? input.responsibleId
        ? { responsible: { connect: { id: input.responsibleId } } }
        : { responsible: { disconnect: true } }
      : {}),
  })

  await writeAudit({
    userId: user.id,
    action: 'document.update',
    objectType: 'Document',
    objectId: id,
    payload: { fields: Object.keys(input) },
  })

  return toDetail(row)
}

export async function changeStatus(
  user: CurrentUser,
  id: string,
  input: ChangeDocumentStatusInput,
): Promise<DocumentDto> {
  assertCan(user, 'WRITE')

  const existing = await repo.findById(id, universityScope(user))
  if (!existing) throw notFound('Документ не найден')

  assertDocumentTransition(
    { status: existing.status, fileReference: existing.fileReference },
    { toStatus: input.status, comment: input.comment },
  )

  const row = await repo.changeStatus(
    id,
    existing.status,
    input.status,
    input.comment ?? null,
    user.id,
  )

  await writeAudit({
    userId: user.id,
    action: 'document.status.change',
    objectType: 'Document',
    objectId: id,
    payload: { from: existing.status, to: input.status },
  })

  return toDetail(row)
}

/**
 * Новая версия документа.
 *
 * Подписанный документ не правится: вместо этого создаётся новая запись со следующим номером
 * версии и теми же привязками, а исходная уходит в архив. Так обе версии остаются в истории.
 */
export async function createNewVersion(user: CurrentUser, id: string): Promise<DocumentDto> {
  assertCan(user, 'WRITE')

  const existing = await repo.findById(id, universityScope(user))
  if (!existing) throw notFound('Документ не найден')

  const created = await repo.create({
    type: existing.type,
    title: existing.title,
    version: nextVersion(existing.version),
    fileReference: null,
    author: { connect: { id: user.id } },
    ...(existing.responsible ? { responsible: { connect: { id: existing.responsible.id } } } : {}),
    ...(existing.cooperationId ? { cooperation: { connect: { id: existing.cooperationId } } } : {}),
    ...(existing.universityId ? { university: { connect: { id: existing.universityId } } } : {}),
    ...(existing.programId ? { program: { connect: { id: existing.programId } } } : {}),
  })

  if (existing.status !== 'ARCHIVED') {
    await repo.changeStatus(
      id,
      existing.status,
      'ARCHIVED',
      `Заменён версией ${created.version}`,
      user.id,
    )
  }

  await writeAudit({
    userId: user.id,
    action: 'document.version.create',
    objectType: 'Document',
    objectId: created.id,
    payload: { previousId: id, version: created.version },
  })

  return toDetail(created)
}
