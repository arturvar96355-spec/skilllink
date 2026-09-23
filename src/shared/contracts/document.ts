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

export interface DocumentTemplateDto {
  key: string
  type: DocumentType
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
}

export interface DocumentPackageResultDto {
  cooperationId: string
  created: GeneratedDocumentDto[]
  /** Шаблоны, пропущенные потому, что документ уже существует. */
  skipped: Array<{ templateKey: string; reason: string }>
  /** Сводный список недостающих реквизитов по всему пакету. */
  missingFields: string[]
  generatedAt: string
}
