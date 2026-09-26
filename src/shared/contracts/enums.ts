/**
 * Перечисления контракта API.
 * Значения совпадают с enum в prisma/schema.prisma, но фронт не зависит от Prisma:
 * импортировать типы из @/generated/prisma запрещено (CLAUDE.md, раздел «Архитектура»).
 */

/**
 * HEAD — роль «Руководитель» из ТЗ (решение 146): права менеджера (WRITE и
 * остальные группы, где состоит MANAGER) плюс право переназначать ответственного
 * за вуз (permissions.ts, ASSIGN_RESPONSIBLE), которого у обычного менеджера нет.
 */
export const USER_ROLES = ['ADMIN', 'MANAGER', 'ANALYST', 'VIEWER', 'UNIVERSITY_REP', 'HEAD'] as const
export type UserRole = (typeof USER_ROLES)[number]

/**
 * Кого можно назначить ответственным за этап, связку, встречу или документ.
 *
 * Ответственный ведёт запись и меняет её, а менять данные могут только ADMIN,
 * MANAGER и HEAD. Аналитик или наблюдатель в этой роли числился бы за работой,
 * которую не может сделать, а представитель вуза — вообще не сотрудник ИТ-Школы.
 */
export const RESPONSIBLE_ROLES = ['ADMIN', 'MANAGER', 'HEAD'] as const satisfies readonly UserRole[]

export function canBeResponsible(role: UserRole): boolean {
  return (RESPONSIBLE_ROLES as readonly UserRole[]).includes(role)
}

export const UNIVERSITY_STATUSES = ['NEW', 'IN_PROGRESS', 'ACTIVE', 'PAUSED', 'ARCHIVED'] as const
export type UniversityStatus = (typeof UNIVERSITY_STATUSES)[number]

export const PROGRAM_LEVELS = [
  'SPO',
  'BACHELOR',
  'SPECIALIST',
  'MASTER',
  'POSTGRADUATE',
  'DPO',
] as const
export type ProgramLevel = (typeof PROGRAM_LEVELS)[number]

export const PROGRAM_STATUSES = ['DRAFT', 'ACTIVE', 'SUSPENDED', 'ARCHIVED'] as const
export type ProgramStatus = (typeof PROGRAM_STATUSES)[number]

export const SKILL_LEVELS = ['BASIC', 'INTERMEDIATE', 'ADVANCED'] as const
export type SkillLevel = (typeof SKILL_LEVELS)[number]

export const SKILL_IMPORTANCE = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const
export type SkillImportance = (typeof SKILL_IMPORTANCE)[number]

export const DATA_ORIGINS = [
  'CURRICULUM',
  'EXPERT',
  'INTEGRATION',
  'IMPORT',
  'MANUAL',
  'MOCK',
] as const
export type DataOrigin = (typeof DATA_ORIGINS)[number]

export const CONFIDENCE_LEVELS = ['LOW', 'MEDIUM', 'HIGH'] as const
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number]

export const PRODUCT_STATUSES = ['PLANNED', 'ACTIVE', 'DEPRECATED'] as const
export type ProductStatus = (typeof PRODUCT_STATUSES)[number]

export const PRODUCT_SKILL_RELEVANCE = ['CORE', 'RELATED', 'OPTIONAL'] as const
export type ProductSkillRelevance = (typeof PRODUCT_SKILL_RELEVANCE)[number]

export const COOPERATION_STATUSES = [
  'DRAFT',
  'ACTIVE',
  'PAUSED',
  'COMPLETED',
  'CANCELLED',
] as const
export type CooperationStatus = (typeof COOPERATION_STATUSES)[number]

/** Открытые связки: по ним идёт работа. Новая связка создаётся только открытой. */
export const OPEN_COOPERATION_STATUSES = ['DRAFT', 'ACTIVE', 'PAUSED'] as const

/**
 * «Активные связи» — те, что в работе прямо сейчас: без приостановленных.
 * Одно определение для главной, личного кабинета и карточки вуза: карточка
 * считала и приостановленные, и одно слово значило в двух местах разное.
 */
export const ACTIVE_COOPERATION_STATUSES = ['DRAFT', 'ACTIVE'] as const

/** Статус передачи ПО вузу — «Каталог по ТЗ» (решение 145). null — не заполнено. */
export const TRANSFER_STATUSES = ['NOT_TRANSFERRED', 'IN_PROGRESS', 'TRANSFERRED', 'REVOKED'] as const
export type TransferStatus = (typeof TRANSFER_STATUSES)[number]

export const STAGE_STATUSES = [
  'NOT_STARTED',
  'IN_PROGRESS',
  'BLOCKED',
  'COMPLETED',
  'CANCELLED',
] as const
export type StageStatus = (typeof STAGE_STATUSES)[number]

export const STAGE_PHASES = [
  'ATTRACTION',
  'FORMALIZATION',
  'IMPLEMENTATION',
  'OPERATION',
  'CONTROL',
] as const
export type StagePhase = (typeof STAGE_PHASES)[number]

export const DOCUMENT_TYPES = [
  'NDA',
  'AGREEMENT',
  'ANNEX',
  'ACT',
  'LICENSE',
  'CURRICULUM',
  'METHODOLOGY',
  'OTHER',
] as const
export type DocumentType = (typeof DOCUMENT_TYPES)[number]

export const DOCUMENT_STATUSES = [
  'DRAFT',
  'REVIEW',
  'APPROVED',
  'SIGNED',
  'REJECTED',
  'ARCHIVED',
] as const
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number]

export const MEETING_FORMATS = ['ONLINE', 'OFFLINE', 'CALL', 'CORRESPONDENCE'] as const
export type MeetingFormat = (typeof MEETING_FORMATS)[number]

export const RECOMMENDATION_TYPES = ['PROGRAM', 'UNIVERSITY', 'SKILL', 'ACTION'] as const
export type RecommendationType = (typeof RECOMMENDATION_TYPES)[number]

export const RECOMMENDATION_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const
export type RecommendationPriority = (typeof RECOMMENDATION_PRIORITIES)[number]

export const RECOMMENDATION_STATUSES = [
  'NEW',
  'IN_PROGRESS',
  'ACCEPTED',
  'DISMISSED',
  'DONE',
] as const
export type RecommendationStatus = (typeof RECOMMENDATION_STATUSES)[number]

/**
 * Статусы, с которыми работает человек (решение 98): Новая → В работе → Выполнена /
 * Отклонена. `ACCEPTED` остался в типе ради базы, но в фильтрах и кнопках его нет.
 */
export const RECOMMENDATION_WORKFLOW_STATUSES = [
  'NEW',
  'IN_PROGRESS',
  'DONE',
  'DISMISSED',
] as const satisfies readonly RecommendationStatus[]

export const DATA_SOURCE_TYPES = ['MANUAL', 'CSV', 'EXTERNAL_API', 'LMS', 'SITE', 'MOCK'] as const
export type DataSourceType = (typeof DATA_SOURCE_TYPES)[number]

export const APPLICATION_STATUSES = [
  'NEW',
  'CONFIRMED',
  'ENROLLED',
  'REJECTED',
  'CANCELLED',
] as const
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number]

/**
 * Правовое основание обработки ПД контактного лица вуза (ч. 1 ст. 6 152-ФЗ, решение 111).
 * Основное для контактов — законный интерес оператора по договору с вузом (п. 7):
 * стороной договора является вуз, а не контакт, поэтому это не `CONTRACT` (п. 5).
 */
export const CONTACT_LEGAL_BASES = ['LEGITIMATE_INTEREST', 'CONTRACT', 'CONSENT', 'OTHER'] as const
export type ContactLegalBasis = (typeof CONTACT_LEGAL_BASES)[number]

/** Статус согласия: `NONE` — основание не согласие; остальные — только при `CONSENT`. */
export const CONSENT_STATUSES = ['NONE', 'OBTAINED', 'WITHDRAWN'] as const
export type ConsentStatus = (typeof CONSENT_STATUSES)[number]

/** Форма согласия (ч. 1 ст. 9: в любой форме, позволяющей подтвердить факт получения). */
export const CONSENT_FORMS = ['WRITTEN', 'ELECTRONIC', 'ORAL_CONFIRMED_BY_EMAIL'] as const
export type ConsentForm = (typeof CONSENT_FORMS)[number]

/** Предпочтительный канал связи с контактом вендора (решение 132): «Способ связи» в файле вендоров. */
export const VENDOR_CONTACT_CHANNELS = ['EMAIL', 'TELEGRAM', 'PHONE'] as const
export type VendorContactChannel = (typeof VENDOR_CONTACT_CHANNELS)[number]

// ──────────────────────── Письма вузов (решение 170) ─────────────────────────

/** Как получено письмо: живого ящика нет — только демо-набор или загруженный `.eml`. */
export const INBOUND_LETTER_SOURCES = ['DEMO', 'EML_UPLOAD'] as const
export type InboundLetterSource = (typeof INBOUND_LETTER_SOURCES)[number]

/**
 * Жизненный цикл обращения: `NEW` → `ANALYZED` (код и/или модель разобрали) →
 * `CONFIRMED` («Верно») | `CORRECTED` («Неверно», с правкой) | `DISMISSED` (не по делу).
 * Из трёх последних переходов нет — решение сотрудника окончательное.
 */
export const INBOUND_LETTER_STATUSES = ['NEW', 'ANALYZED', 'CONFIRMED', 'CORRECTED', 'DISMISSED'] as const
export type InboundLetterStatus = (typeof INBOUND_LETTER_STATUSES)[number]

/** Проверенные и исправленные — окончательные статусы, дальше только чтение. */
export const INBOUND_LETTER_OPEN_STATUSES = ['NEW', 'ANALYZED'] as const satisfies readonly InboundLetterStatus[]

/** Ровно шесть групп, с чем чаще всего пишут вузы (решение 170). */
export const INBOUND_LETTER_GROUPS = [
  'STAGE_SHIFT',
  'DOCUMENTS',
  'MEETING',
  'QUESTION',
  'PAUSE_OR_REFUSAL',
  'OTHER',
] as const
export type InboundLetterGroup = (typeof INBOUND_LETTER_GROUPS)[number]

/** Чем получен разбор: моделью или запасным путём по ключевым словам. */
export const INBOUND_LETTER_ANALYZED_BY = ['MODEL', 'RULES'] as const
export type InboundLetterAnalyzedBy = (typeof INBOUND_LETTER_ANALYZED_BY)[number]

/** Итог проверки сотрудником: «Верно» — разбор принят как есть; «Неверно» — исправлен. */
export const INBOUND_LETTER_VERDICTS = ['CORRECT', 'INCORRECT'] as const
export type InboundLetterVerdict = (typeof INBOUND_LETTER_VERDICTS)[number]

/** Статус задания, которое создаёт проверка письма ответственному за вуз. */
export const INBOUND_LETTER_TASK_STATUSES = ['OPEN', 'DONE'] as const
export type InboundLetterTaskStatus = (typeof INBOUND_LETTER_TASK_STATUSES)[number]
