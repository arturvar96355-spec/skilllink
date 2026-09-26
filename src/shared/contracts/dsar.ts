import type { UserRefDto } from './workflow'

/**
 * «Всё о субъекте» по 152-ФЗ (решение 116): выгрузка сведений, обезличивание
 * и реестр запросов субъектов.
 */

export const DSAR_SUBJECT_TYPES = ['USER', 'CONTACT'] as const
export type DsarSubjectType = (typeof DSAR_SUBJECT_TYPES)[number]

export const DSAR_REQUEST_KINDS = ['EXPORT', 'ERASE'] as const
export type DsarRequestKind = (typeof DSAR_REQUEST_KINDS)[number]

export const DSAR_REQUEST_STATUSES = ['OPEN', 'COMPLETED'] as const
export type DsarRequestStatus = (typeof DSAR_REQUEST_STATUSES)[number]

export const DSAR_REQUEST_CHANNELS = ['SELF_SERVICE', 'LETTER', 'ADMIN'] as const
export type DsarRequestChannel = (typeof DSAR_REQUEST_CHANNELS)[number]

export type DsarEraseAction = 'redact' | 'delete' | 'keep'

/** Раздел выгрузки: одна модель базы. `total` — настоящее число, `items` — не больше предела. */
export interface DsarSectionDto {
  title: string
  model: string
  total: number
  returned: number
  truncated: boolean
  /** Что делает с разделом обезличивание и почему. */
  onErase: DsarEraseAction
  reason: string
  items: Array<Record<string, unknown>>
}

export interface DsarTransferDto {
  recipient: string
  what: string
  /** Передача за рубеж; null — зависит от выбора пользователя. */
  crossBorder: boolean | null
  when: string
}

/**
 * Выгрузка «всё о субъекте» — сведения ч. 7 ст. 14 152-ФЗ и сами данные.
 * Ни паролей, ни хешей, ни токенов в ней нет на любой глубине.
 */
export interface DsarExportDto {
  subject: { type: DsarSubjectType; id: string; displayName: string; erased: boolean }
  generatedAt: string
  /** Кто сформировал: администратор (id и роль) или сам субъект. */
  generatedBy: { id: string; role: string; self: boolean }
  /** Запрос в реестре, который закрыт этой выгрузкой. */
  requestId: string | null
  operator: { name: string; address: string; responsibleContact: string; note: string }
  purposes: readonly string[]
  legalBasis: readonly string[]
  categories: readonly string[]
  sources: readonly string[]
  processingMethods: string
  storageLocation: string
  recipients: DsarTransferDto[]
  retention: readonly string[]
  rights: string
  data: Record<string, DsarSectionDto>
  auditTrail: { byActor: DsarSectionDto | null; aboutSubject: DsarSectionDto }
  counts: Record<string, number>
  notes: string[]
}

export interface DsarRequestDto {
  id: string
  subjectType: DsarSubjectType
  subjectId: string
  kind: DsarRequestKind
  channel: DsarRequestChannel
  status: DsarRequestStatus
  requestedBy: UserRefDto
  requestedAt: string
  dueAt: string
  completedAt: string | null
  /** Открыт и срок прошёл. */
  overdue: boolean
  /** Итог: счётчики по разделам, без данных. */
  summary: Record<string, unknown> | null
}

export interface DsarEraseResultDto {
  subject: { type: DsarSubjectType; id: string }
  /** Уже был обезличен: ничего не менялось, открытые запросы на уничтожение закрыты. */
  alreadyErased: boolean
  erasedAt: string
  requestId: string | null
  /** Раздел → действие и число затронутых строк. */
  sections: Record<string, { action: DsarEraseAction; rows: number }>
}
