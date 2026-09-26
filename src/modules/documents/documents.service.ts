import { prisma } from '@/shared/db/prisma'
import { conflict, notFound, validationError } from '@/shared/http/errors'
import { pageMeta } from '@/shared/http/pagination'
import {
  assertCan,
  canSeeInternalNotes,
  isUniversityVisible,
  universityScope,
} from '@/shared/auth/permissions'
import { writeAudit } from '@/shared/audit/audit'
import { assertStaffResponsible, resolveEntityLinks } from '@/shared/links/entity-links'
import type { CurrentUser } from '@/shared/auth/current-user'
import type { PageMeta } from '@/shared/contracts/common'
import type {
  DocumentDto,
  DocumentLinksDto,
  DocumentListItemDto,
  DocumentPackageResultDto,
  DocumentStatusChangeDto,
  SigningChecklistEffectDto,
  DocumentTemplateDto,
  GeneratedDocumentDto,
  SkippedTemplateDto,
} from '@/shared/contracts/document'
import {
  DOCUMENT_TEMPLATES,
  TEMPLATE_BY_KEY,
  TEMPLATE_PLACEHOLDERS,
  placeholderLabel,
} from '@/shared/config/document-templates.config'
import { toIso, toIsoRequired } from '@/shared/utils/date'
import { PROGRAM_LEVEL_FULL_LABELS } from '@/shared/contracts/labels'
import { assertCooperationOpen } from '@/modules/cooperation/cooperation.rules'
import * as repo from './documents.repo'
import { lockCooperation } from '@/modules/workflow/workflow.repo'
import { markTasksBySignedDocuments } from '@/modules/workflow/workflow.service'
import { SIGNING_STAGE_NUMBER } from '@/shared/config/workflow.config'
import { log } from '@/shared/log/logger'
import {
  assertDocumentEditable,
  assertDocumentHasContent,
  assertDocumentTransition,
  assertHasLink,
  nextVersion,
  packageSkipReason,
  SIGNING_DOCUMENT_TYPES,
  areSigningDocumentsSigned,
  positionInText,
  renderTemplate,
  type ExistingPackageDocument,
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
    universityShortName: row.university?.shortName ?? null,
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
    templateName: row.templateKey ? (TEMPLATE_BY_KEY.get(row.templateKey)?.name ?? null) : null,
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

/**
 * Карточка документа с историей статусов.
 *
 * Комментарий в истории — внутренняя заметка: причина отклонения, что доработать.
 * Представитель вуза его не видит, как не видит комментариев
 * в истории этапов и в ленте событий. Пользователь — обязательный аргумент,
 * чтобы ни один путь к карточке не мог об этом забыть.
 */
function toDetail(row: repo.DocumentDetailRow, user: CurrentUser): DocumentDto {
  const hideInternalNotes = !canSeeInternalNotes(user)
  return {
    ...toListItem(row),
    history: row.history.map((entry) => ({
      id: entry.id,
      fromStatus: entry.fromStatus,
      toStatus: entry.toStatus,
      comment: hideInternalNotes ? null : entry.comment,
      changedBy: entry.changedBy,
      changedAt: toIsoRequired(entry.changedAt),
    })),
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
  return toDetail(row, user)
}

export async function create(
  user: CurrentUser,
  input: CreateDocumentInput,
): Promise<DocumentDto> {
  assertCan(user, 'WRITE')
  assertHasLink(input)
  await resolveEntityLinks(user, input)
  if (input.responsibleId) await assertStaffResponsible(input.responsibleId)

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

  return toDetail(row, user)
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
  if (input.responsibleId) await assertStaffResponsible(input.responsibleId)
  // Итог правки подчиняется тем же правилам, что и переход: у документа на согласовании
  // или утверждённого содержимое не стирается.
  assertDocumentHasContent({
    status: existing.status,
    fileReference: input.fileReference !== undefined ? input.fileReference : existing.fileReference,
    content: existing.content,
  })

  const row = await repo.update(id, existing.status, {
    ...(input.type !== undefined ? { type: input.type } : {}),
    ...(input.title !== undefined ? { title: input.title } : {}),
    ...(input.version !== undefined ? { version: input.version } : {}),
    ...(input.fileReference !== undefined ? { fileReference: input.fileReference } : {}),
    ...(input.issuedAt !== undefined
      ? { issuedAt: input.issuedAt ? new Date(input.issuedAt) : null }
      : {}),
    ...(input.responsibleId !== undefined ? { responsibleId: input.responsibleId } : {}),
  })

  await writeAudit({
    userId: user.id,
    action: 'document.update',
    objectType: 'Document',
    objectId: id,
    payload: { fields: Object.keys(input) },
  })

  return toDetail(row, user)
}

export async function changeStatus(
  user: CurrentUser,
  id: string,
  input: ChangeDocumentStatusInput,
): Promise<DocumentStatusChangeDto> {
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

  const stageChecklist =
    input.status === 'SIGNED' && existing.cooperationId && SIGNING_DOCUMENT_TYPES.includes(existing.type)
      ? await markSigningStage(existing.cooperationId, user.id, id)
      : null

  return { ...toDetail(row, user), ...(stageChecklist ? { stageChecklist } : {}) }
}

/**
 * Подписан договор или лицензия — отметить пункты этапа «Подписание документов»,
 * если договор по связке подписан и другие договоры подписи не ждут (решение 87).
 *
 * Статус документа к этому моменту уже сменён и записан: сбой здесь его не отменяет
 * и наружу не выходит — пункты тогда отмечаются вручную.
 */
async function markSigningStage(
  cooperationId: string,
  userId: string,
  documentId: string,
): Promise<SigningChecklistEffectDto | null> {
  try {
    const documents = await repo.findPackageDocuments(cooperationId)
    if (!areSigningDocumentsSigned(documents)) {
      return { stageNumber: SIGNING_STAGE_NUMBER, marked: 0, outcome: 'pending-documents' }
    }
    return await markTasksBySignedDocuments(cooperationId, userId, documentId)
  } catch (error) {
    log.error('[DOCUMENTS] не удалось отметить пункты этапа подписания', { cooperationId, documentId, err: error })
    return null
  }
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
  // Версия — от действующего документа. От архивного получилась бы ещё одна «версия 2»
  // рядом с уже существующей: номер считается от исходной, а не от последней.
  if (existing.status === 'ARCHIVED') {
    throw conflict('Документ в архиве: новую версию создают от действующей', {
      status: existing.status,
    })
  }

  const created = await repo.createVersion(
    id,
    existing.status,
    {
      type: existing.type,
      title: existing.title,
      version: nextVersion(existing.version),
      fileReference: null,
      author: { connect: { id: user.id } },
      ...(existing.responsible ? { responsible: { connect: { id: existing.responsible.id } } } : {}),
      ...(existing.cooperationId ? { cooperation: { connect: { id: existing.cooperationId } } } : {}),
      ...(existing.universityId ? { university: { connect: { id: existing.universityId } } } : {}),
      ...(existing.programId ? { program: { connect: { id: existing.programId } } } : {}),
    },
    user.id,
  )

  await writeAudit({
    userId: user.id,
    action: 'document.version.create',
    objectType: 'Document',
    objectId: created.id,
    payload: { previousId: id, version: created.version },
  })

  return toDetail(created, user)
}

// ─────────────────── Сборка пакета документов из шаблонов ───────────────────

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
    name: template.name,
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
 * Шаблон, по которому в связке уже есть действующий документ (собранный или заведённый
 * вручную, см. findExistingForTemplate), повторно не собирается: иначе повторное нажатие
 * кнопки засыпало бы связку дублями. Пересборка — явным флагом `force`.
 * Лицензия без выбранного IT-продукта не собирается никогда: у неё нет предмета.
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
    'contact.position': positionInText(contact?.position),
    'program.name': source.program.name,
    'program.level': PROGRAM_LEVEL_FULL_LABELS[source.program.level] ?? source.program.level,
    'program.code': source.program.code,
    'product.name': source.product?.name ?? null,
    'product.version': source.product?.version ?? null,
    'responsible.fullName': source.responsible.fullName,
    'responsible.position': positionInText(source.responsible.position),
    'cooperation.goal': source.goal,
    date: new Date().toLocaleDateString('ru-RU'),
  }

  const created: GeneratedDocumentDto[] = []
  const skipped: SkippedTemplateDto[] = []
  const missingFields = new Set<string>()

  // Проверка «что уже есть» и создание — одной транзакцией в очереди связки
  // (lockCooperation). Иначе двойное нажатие «Собрать пакет» прошло бы проверку
  // дважды и собрало два одинаковых пакета — ровно то, от чего проверка защищает.
  await prisma.$transaction(async (tx) => {
    await lockCooperation(tx, cooperationId)
    const documents: ExistingPackageDocument[] = input.force
      ? []
      : await repo.findPackageDocuments(cooperationId, tx)

    for (const template of templates) {
      const reason = packageSkipReason(template, {
        documents,
        hasProduct: source.product !== null,
        force: input.force,
      })
      if (reason) {
        skipped.push({ templateKey: template.key, templateName: template.name, reason })
        continue
      }

      const renderedTitle = renderTemplate(template.title, context)
      const renderedBody = renderTemplate(template.body, context)
      for (const field of renderedBody.missing) missingFields.add(field)
      for (const field of renderedTitle.missing) missingFields.add(field)

      const row = await repo.create(
        {
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
        },
        tx,
      )

      // Собранный в этом же вызове тоже считается: ключ, переданный дважды без force, —
      // один документ.
      documents.push({
        title: row.title,
        type: row.type,
        status: row.status,
        templateKey: row.templateKey,
      })

      const missing = [...new Set([...renderedTitle.missing, ...renderedBody.missing])].sort()
      created.push({
        document: toListItem(row),
        templateKey: template.key,
        missing,
        missingLabels: missing.map(placeholderLabel),
      })
    }
  })

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

  const missingSorted = [...missingFields].sort()
  return {
    cooperationId,
    created,
    skipped,
    missingFields: missingSorted,
    missingFieldLabels: missingSorted.map(placeholderLabel),
    generatedAt: new Date().toISOString(),
  }
}
