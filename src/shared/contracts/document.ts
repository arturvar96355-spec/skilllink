import type { DocumentStatus, DocumentType } from './enums'
import type { UserRefDto } from './workflow'

export interface DocumentLinksDto {
  cooperationId: string | null
  universityId: string | null
  universityName: string | null
  /** Краткое название вуза («СПбГУТ») — для плотной строки реестра (решение 44). */
  universityShortName: string | null
  programId: string | null
  programName: string | null
}

export interface DocumentListItemDto {
  id: string
  type: DocumentType
  title: string
  version: string
  status: DocumentStatus
  /** Ссылка на внешний документ. Загрузка файлов — P2 (решение 14). */
  fileReference: string | null
  /** Текст, собранный из шаблона. null — документ заведён вручную. */
  content: string | null
  /** Ключ шаблона, из которого собран документ. */
  templateKey: string | null
  /** Название шаблона по-русски («Договор о сотрудничестве»); null — документ не из шаблона. */
  templateName: string | null
  author: UserRefDto | null
  responsible: UserRefDto | null
  issuedAt: string | null
  signedAt: string | null
  links: DocumentLinksDto
  createdAt: string
  updatedAt: string
}

export interface DocumentHistoryEntryDto {
  id: string
  fromStatus: DocumentStatus | null
  toStatus: DocumentStatus
  comment: string | null
  changedBy: UserRefDto
  changedAt: string
}

export interface DocumentDto extends DocumentListItemDto {
  history: DocumentHistoryEntryDto[]
}

/**
 * Что подпись документа сделала с чек-листом этапа «Подписание документов» (решение 87).
 *
 * - `marked` — пункты отмечены сейчас (`marked` — сколько);
 * - `nothing-to-mark` — они уже были отмечены;
 * - `pending-documents` — договор по связке не подписан или другой договор
 *   ещё ждёт подписи (лицензию этап 6 не ждёт — она для этапа 7);
 * - `locked` — этап за контрольной точкой: не закрыты этапы до него;
 * - `stage-closed` — этап завершён или отменён, его чек-лист не меняется;
 * - `cooperation-closed` — связка закрыта.
 */
export interface SigningChecklistEffectDto {
  stageNumber: number
  marked: number
  outcome: 'marked' | 'nothing-to-mark' | 'pending-documents' | 'locked' | 'stage-closed' | 'cooperation-closed'
}

/** Ответ на смену статуса документа. `stageChecklist` — только когда документ подписан. */
export interface DocumentStatusChangeDto extends DocumentDto {
  stageChecklist?: SigningChecklistEffectDto
}

export interface DocumentTemplateDto {
  key: string
  type: DocumentType
  /** Название шаблона по-русски. */
  name: string
  title: string
  description: string
  inDefaultPackage: boolean
  /** Какие реквизиты подставляются в этот шаблон. */
  placeholders: string[]
}

export interface GeneratedDocumentDto {
  document: DocumentListItemDto
  templateKey: string
  /** Реквизиты, которых не хватило: в тексте на их месте прочерки. */
  missing: string[]
  /** Те же реквизиты подписями для человека, в том же порядке. */
  missingLabels: string[]
}

export interface SkippedTemplateDto {
  templateKey: string
  /** Название шаблона по-русски — его и показывать, а не ключ. */
  templateName: string
  /** «уже есть: «Договор…», черновик» или «не выбран IT-продукт — …». */
  reason: string
}

export interface DocumentPackageResultDto {
  cooperationId: string
  created: GeneratedDocumentDto[]
  /** Шаблоны, которые не собраны: документ уже есть или не выбран IT-продукт. */
  skipped: SkippedTemplateDto[]
  /** Сводный список недостающих реквизитов по всему пакету — ключи подстановок. */
  missingFields: string[]
  /** Те же реквизиты подписями для человека, в том же порядке. */
  missingFieldLabels: string[]
  generatedAt: string
}
