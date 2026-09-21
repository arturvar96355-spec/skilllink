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
  DocumentPackageResultDto,
  DocumentTemplateDto,
  GeneratedDocumentDto,
} from '@/shared/contracts/document'
import {
  DOCUMENT_TEMPLATES,
  TEMPLATE_BY_KEY,
  TEMPLATE_PLACEHOLDERS,
} from '@/shared/config/document-templates.config'
import { toIso, toIsoRequired } from '@/shared/utils/date'
import { assertCooperationOpen } from '@/modules/cooperation/cooperation.rules'
import * as repo from './documents.repo'
import {
  assertDocumentEditable,
  assertDocumentTransition,
  assertHasLink,
  nextVersion,
  renderTemplate,
  type TemplateContext,
} from './documents.rules'
import type {
  ChangeDocumentStatusInput,
  CreateDocumentInput,
  DocumentListQuery,
  GenerateDocumentsInput,
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
    content: row.content,
    templateKey: row.templateKey,
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
    {
      status: existing.status,
      fileReference: existing.fileReference,
      content: existing.content,
    },
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

// ─────────────────── Сборка пакета документов из шаблонов ───────────────────

const PROGRAM_LEVEL_LABELS: Record<string, string> = {
  SPO: 'среднее профессиональное образование',
  BACHELOR: 'бакалавриат',
  SPECIALIST: 'специалитет',
  MASTER: 'магистратура',
  POSTGRADUATE: 'аспирантура',
  DPO: 'дополнительное профессиональное образование',
}

/** Какие подстановки поддерживает каждый шаблон — нужно фронту для подсказки. */
function placeholdersOf(body: string, title: string): string[] {
  const found = new Set<string>()
  for (const match of `${title}\n${body}`.matchAll(/\{\{\s*([a-zA-Z.]+)\s*\}\}/g)) {
    if (match[1]) found.add(match[1])
  }
  return [...found].sort()
}

export function listTemplates(user: CurrentUser): DocumentTemplateDto[] {
  assertCan(user, 'READ')
  return DOCUMENT_TEMPLATES.map((template) => ({
    key: template.key,
    type: template.type,
    title: template.title,
    description: template.description,
    inDefaultPackage: template.inDefaultPackage,
    placeholders: placeholdersOf(template.body, template.title),
  }))
}

/** Доступные для подстановки реквизиты. Список общий для всех шаблонов. */
export function listPlaceholders(): string[] {
  return [...TEMPLATE_PLACEHOLDERS]
}

/**
 * Собирает пакет документов по связке с автоподстановкой реквизитов (концепция).
 *
 * Документ по уже использованному шаблону повторно не создаётся: иначе повторное нажатие
 * кнопки засыпало бы связку дублями. Пересборка — явным флагом `force`.
 */
export async function generatePackage(
  user: CurrentUser,
  cooperationId: string,
  input: GenerateDocumentsInput,
): Promise<DocumentPackageResultDto> {
  assertCan(user, 'WRITE')

  const source = await repo.loadTemplateContextSource(cooperationId)
  if (!source || !isUniversityVisible(user, source.universityId)) {
    throw notFound('Связка не найдена')
  }
  // Собирать пакет для закрытой связки бессмысленно: документы оформляют идущую работу.
  assertCooperationOpen(source.status)

  const requestedKeys = input.templateKeys ?? null
  if (requestedKeys) {
    const unknown = requestedKeys.filter((key) => !TEMPLATE_BY_KEY.has(key))
    if (unknown.length > 0) {
      throw validationError('Указаны несуществующие шаблоны', [
        { field: 'templateKeys', message: `Не найдены: ${unknown.join(', ')}` },
      ])
    }
  }

  const templates = requestedKeys
    ? requestedKeys.map((key) => TEMPLATE_BY_KEY.get(key)!)
    : DOCUMENT_TEMPLATES.filter((template) => template.inDefaultPackage)

  const contact = source.university.contacts[0]
  const context: TemplateContext = {
    'university.name': source.university.name,
    'university.shortName': source.university.shortName ?? source.university.name,
    'university.city': source.university.city,
    'university.address': source.university.address,
    'university.website': source.university.website,
    'contact.fullName': contact?.fullName ?? null,
    'contact.position': contact?.position ?? null,
    'program.name': source.program.name,
    'program.level': PROGRAM_LEVEL_LABELS[source.program.level] ?? source.program.level,
    'program.code': source.program.code,
    'product.name': source.product?.name ?? null,
    'product.version': source.product?.version ?? null,
    'responsible.fullName': source.responsible.fullName,
    'responsible.position': source.responsible.position,
    'cooperation.goal': source.goal,
    date: new Date().toLocaleDateString('ru-RU'),
  }

  const existingKeys = input.force ? new Set<string>() : await repo.findTemplateKeys(cooperationId)

  const created: GeneratedDocumentDto[] = []
  const skipped: Array<{ templateKey: string; reason: string }> = []
  const missingFields = new Set<string>()

  for (const template of templates) {
    if (existingKeys.has(template.key)) {
      skipped.push({
        templateKey: template.key,
        reason: 'Документ по этому шаблону в связке уже есть',
      })
      continue
    }

    const renderedTitle = renderTemplate(template.title, context)
    const renderedBody = renderTemplate(template.body, context)
    for (const field of renderedBody.missing) missingFields.add(field)
    for (const field of renderedTitle.missing) missingFields.add(field)

    const row = await repo.create({
      type: template.type,
      title: renderedTitle.text,
      version: '1',
      content: renderedBody.text,
      templateKey: template.key,
      fileReference: null,
      author: { connect: { id: user.id } },
      // Ответственный — тот, кто ведёт связку, а не тот, кто нажал «собрать пакет».
      responsible: { connect: { id: source.responsible.id } },
      cooperation: { connect: { id: cooperationId } },
      university: { connect: { id: source.universityId } },
    })

    created.push({
      document: toListItem(row),
      templateKey: template.key,
      missing: [...new Set([...renderedTitle.missing, ...renderedBody.missing])].sort(),
    })
  }

  await writeAudit({
    userId: user.id,
    action: 'document.package.generate',
    objectType: 'Cooperation',
    objectId: cooperationId,
    payload: {
      created: created.length,
      skipped: skipped.length,
      missingFields: [...missingFields],
    },
  })

  return {
    cooperationId,
    created,
    skipped,
    missingFields: [...missingFields].sort(),
    generatedAt: new Date().toISOString(),
  }
}
