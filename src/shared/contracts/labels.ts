import type {
  ApplicationStatus,
  ConfidenceLevel,
  CooperationStatus,
  DataOrigin,
  DataSourceType,
  DocumentStatus,
  DocumentType,
  MeetingFormat,
  ProductSkillRelevance,
  ProductStatus,
  ProgramLevel,
  ProgramStatus,
  RecommendationPriority,
  RecommendationStatus,
  RecommendationType,
  SkillImportance,
  SkillLevel,
  StagePhase,
  StageStatus,
  UniversityStatus,
  UserRole,
} from './enums'

/**
 * Русские подписи к значениям перечислений.
 *
 * API отдаёт коды (`IN_PROGRESS`), а не слова: коды не зависят от языка интерфейса
 * и не ломаются при переводе. Но словарь подписей должен быть один на всю систему —
 * иначе надпись в интерфейсе разойдётся с тем, что бэкенд уже пишет в обоснованиях
 * рекомендаций, в ленте событий вуза и в выгрузке CSV.
 *
 * Фронт импортирует их отсюда так же, как и типы:
 * ```ts
 * import { STAGE_STATUS_LABELS } from '@/shared/contracts'
 * ```
 */

export const USER_ROLE_LABELS: Record<UserRole, string> = {
  ADMIN: 'Администратор',
  MANAGER: 'Менеджер партнёрств',
  ANALYST: 'Аналитик',
  VIEWER: 'Наблюдатель',
  UNIVERSITY_REP: 'Представитель вуза',
}

export const UNIVERSITY_STATUS_LABELS: Record<UniversityStatus, string> = {
  NEW: 'Новый',
  IN_PROGRESS: 'В работе',
  ACTIVE: 'Активен',
  PAUSED: 'Приостановлен',
  ARCHIVED: 'В архиве',
}

export const PROGRAM_LEVEL_LABELS: Record<ProgramLevel, string> = {
  SPO: 'СПО',
  BACHELOR: 'Бакалавриат',
  SPECIALIST: 'Специалитет',
  MASTER: 'Магистратура',
  POSTGRADUATE: 'Аспирантура',
  DPO: 'ДПО',
}

/** Развёрнутые названия уровней: для документов, где сокращение выглядит неуместно. */
export const PROGRAM_LEVEL_FULL_LABELS: Record<ProgramLevel, string> = {
  SPO: 'среднее профессиональное образование',
  BACHELOR: 'бакалавриат',
  SPECIALIST: 'специалитет',
  MASTER: 'магистратура',
  POSTGRADUATE: 'аспирантура',
  DPO: 'дополнительное профессиональное образование',
}

export const PROGRAM_STATUS_LABELS: Record<ProgramStatus, string> = {
  DRAFT: 'Черновик',
  ACTIVE: 'Действует',
  SUSPENDED: 'Приостановлена',
  ARCHIVED: 'В архиве',
}

export const SKILL_LEVEL_LABELS: Record<SkillLevel, string> = {
  BASIC: 'Базовый',
  INTERMEDIATE: 'Средний',
  ADVANCED: 'Продвинутый',
}

export const SKILL_IMPORTANCE_LABELS: Record<SkillImportance, string> = {
  LOW: 'Низкая',
  MEDIUM: 'Средняя',
  HIGH: 'Высокая',
  CRITICAL: 'Критичная',
}

export const DATA_ORIGIN_LABELS: Record<DataOrigin, string> = {
  CURRICULUM: 'учебный план',
  EXPERT: 'экспертная оценка',
  INTEGRATION: 'интеграция',
  IMPORT: 'импорт данных',
  MANUAL: 'ручной ввод',
  MOCK: 'демонстрационные данные',
}

export const CONFIDENCE_LABELS: Record<ConfidenceLevel, string> = {
  LOW: 'Низкая',
  MEDIUM: 'Средняя',
  HIGH: 'Высокая',
}

export const PRODUCT_STATUS_LABELS: Record<ProductStatus, string> = {
  PLANNED: 'Планируется',
  ACTIVE: 'Действует',
  DEPRECATED: 'Выводится из обращения',
}

export const PRODUCT_SKILL_RELEVANCE_LABELS: Record<ProductSkillRelevance, string> = {
  CORE: 'Ключевой',
  RELATED: 'Смежный',
  OPTIONAL: 'Дополнительный',
}

export const COOPERATION_STATUS_LABELS: Record<CooperationStatus, string> = {
  DRAFT: 'Черновик',
  ACTIVE: 'В работе',
  PAUSED: 'Приостановлена',
  COMPLETED: 'Завершена',
  CANCELLED: 'Отменена',
}

export const STAGE_STATUS_LABELS: Record<StageStatus, string> = {
  NOT_STARTED: 'Не начат',
  IN_PROGRESS: 'В работе',
  BLOCKED: 'Заблокирован',
  COMPLETED: 'Завершён',
  CANCELLED: 'Отменён',
}

/** Фазы конвейера из концепции. */
export const STAGE_PHASE_LABELS: Record<StagePhase, string> = {
  ATTRACTION: 'Привлечение',
  FORMALIZATION: 'Оформление',
  IMPLEMENTATION: 'Внедрение',
  OPERATION: 'Эксплуатация',
  CONTROL: 'Контроль',
}

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  NDA: 'Соглашение о неразглашении',
  AGREEMENT: 'Договор',
  ANNEX: 'Приложение',
  ACT: 'Акт',
  LICENSE: 'Лицензия',
  CURRICULUM: 'Учебный план',
  METHODOLOGY: 'Методические материалы',
  OTHER: 'Другое',
}

export const DOCUMENT_STATUS_LABELS: Record<DocumentStatus, string> = {
  DRAFT: 'Черновик',
  REVIEW: 'На согласовании',
  APPROVED: 'Согласован',
  SIGNED: 'Подписан',
  REJECTED: 'Отклонён',
  ARCHIVED: 'В архиве',
}

export const MEETING_FORMAT_LABELS: Record<MeetingFormat, string> = {
  ONLINE: 'Онлайн',
  OFFLINE: 'Очно',
  CALL: 'Звонок',
  CORRESPONDENCE: 'Переписка',
}

export const RECOMMENDATION_TYPE_LABELS: Record<RecommendationType, string> = {
  PROGRAM: 'Программа',
  UNIVERSITY: 'Вуз',
  SKILL: 'Навык',
  ACTION: 'Действие',
}

export const RECOMMENDATION_PRIORITY_LABELS: Record<RecommendationPriority, string> = {
  LOW: 'Низкий',
  MEDIUM: 'Средний',
  HIGH: 'Высокий',
  CRITICAL: 'Критичный',
}

export const RECOMMENDATION_STATUS_LABELS: Record<RecommendationStatus, string> = {
  NEW: 'Новая',
  IN_PROGRESS: 'В работе',
  ACCEPTED: 'Принята',
  DISMISSED: 'Отклонена',
  DONE: 'Закрыта',
}

export const DATA_SOURCE_TYPE_LABELS: Record<DataSourceType, string> = {
  MANUAL: 'Ручной ввод',
  CSV: 'Выгрузка CSV',
  EXTERNAL_API: 'Внешний API',
  LMS: 'LMS',
  SITE: 'Сайт',
  MOCK: 'Демонстрационный набор',
}

export const APPLICATION_STATUS_LABELS: Record<ApplicationStatus, string> = {
  NEW: 'Новая',
  CONFIRMED: 'Подтверждена',
  ENROLLED: 'Зачислен',
  REJECTED: 'Отклонена',
  CANCELLED: 'Отменена',
}

/** Происхождение показателя: как объяснить пользователю, откуда взялось число. */
export const METRIC_BASIS_LABELS = {
  actual: 'Фактические данные',
  estimate: 'Оценка',
  none: 'Нет данных',
} as const
