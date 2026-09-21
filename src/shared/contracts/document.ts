import type { DocumentStatus, DocumentType } from './enums'
import type { UserRefDto } from './workflow'

export interface DocumentLinksDto {
  cooperationId: string | null
  universityId: string | null
  universityName: string | null
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
