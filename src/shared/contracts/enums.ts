/**
 * Перечисления контракта API.
 * Значения совпадают с enum в prisma/schema.prisma, но фронт не зависит от Prisma:
 * импортировать типы из @/generated/prisma запрещено (CLAUDE.md, раздел «Архитектура»).
 */

export const USER_ROLES = ['ADMIN', 'MANAGER', 'ANALYST', 'VIEWER', 'UNIVERSITY_REP'] as const
export type UserRole = (typeof USER_ROLES)[number]

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
