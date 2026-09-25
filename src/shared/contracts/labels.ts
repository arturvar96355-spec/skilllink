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
import type { AuditActionCode, AuditObjectType } from './audit'

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

/**
 * Показатели набора программы — те три, из которых считается рейтинг (решение 7).
 * Одна подпись на рейтинг, текст рекомендаций и интерфейс.
 */
export const PROGRAM_METRIC_LABELS = {
  applicationCount: 'Заявки на обучение',
  studentCount: 'Количество обучающихся',
  groupCount: 'Количество параллельных групп',
} as const satisfies Record<string, string>

/**
 * Подпись кнопки, переводящей рекомендацию в статус. Кнопке нужен глагол:
 * на кнопке «Принята» непонятно, сделано это уже или ещё только предлагается.
 */
export const RECOMMENDATION_STATUS_ACTIONS: Record<RecommendationStatus, string> = {
  NEW: 'Вернуть в новые',
  IN_PROGRESS: 'Взять в работу',
  ACCEPTED: 'Принять',
  DISMISSED: 'Отклонить',
  DONE: 'Закрыть',
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

/**
 * Действие в журнале — словами (вкладка «Журнал действий» в настройках).
 * Код действия (`stage.status.change`) нужен фильтру API, человеку — фраза.
 */
export const AUDIT_ACTION_LABELS: Record<AuditActionCode, string> = {
  'auth.login.success': 'Вход в систему',
  'auth.login.failure': 'Неудачная попытка входа',
  'auth.login.blocked': 'Вход закрыт после неудачных попыток',
  'user.create': 'Заведён пользователь',
  'user.update': 'Изменены данные пользователя',
  'user.role.change': 'Изменена роль пользователя',
  'user.block': 'Пользователь заблокирован',
  'user.unblock': 'Пользователь разблокирован',
  'user.password.reset': 'Выдан временный пароль',
  'user.password.change': 'Пользователь сменил пароль',
  'university.create': 'Создан вуз',
  'university.update': 'Изменён вуз',
  'university.archive': 'Вуз отправлен в архив',
  'university.restore': 'Вуз возвращён из архива',
  'contact.anonymize': 'Контакт вуза обезличен',
  'program.create': 'Создана программа',
  'program.update': 'Изменена программа',
  'program.skills.replace': 'Изменены навыки программы',
  'program.archive': 'Программа отправлена в архив',
  'program.restore': 'Программа возвращена из архива',
  'cooperation.create': 'Создана связка',
  'cooperation.update': 'Изменена связка',
  'stage.status.change': 'Изменён статус этапа',
  'stage.fields.change': 'Изменены поля этапа',
  'stage.auto.recompute': 'Статус этапа пересчитан автоматически',
  'task.toggle': 'Отмечен пункт чек-листа',
  'application.create': 'Подана заявка на обучение',
  'recommendation.generate': 'Пересобраны рекомендации',
  'recommendation.status.change': 'Изменён статус рекомендации',
  'ai.draft': 'Черновик ИИ-помощника',
  'document.create': 'Создан документ',
  'document.update': 'Изменён документ',
  'document.status.change': 'Изменён статус документа',
  'document.version.create': 'Создана новая версия документа',
  'document.package.generate': 'Собран пакет документов',
  'meeting.create': 'Назначена встреча',
  'meeting.update': 'Изменена встреча',
  'portal.material.confirm': 'Вуз подтвердил получение материалов',
  'portal.metrics.update': 'Вуз обновил показатели программы',
  'datasource.sync': 'Загружены рыночные данные',
  'product.create': 'Создан IT-продукт',
  'product.update': 'Изменён IT-продукт',
  'product.skills.replace': 'Изменены навыки IT-продукта',
  'product.version.release': 'Выпущена версия IT-продукта',
  'export.download': 'Выгрузка в CSV',
  'audit.retention': 'Очистка журнала по сроку хранения',
  'import.apply': 'Загрузка реестра из CSV',
}

/** Тип объекта записи журнала — словами, для фильтра и строки записи. */
export const AUDIT_OBJECT_TYPE_LABELS: Record<AuditObjectType, string> = {
  User: 'Пользователь',
  University: 'Вуз',
  Contact: 'Контакт вуза',
  EducationalProgram: 'Программа',
  Cooperation: 'Связка',
  WorkflowStage: 'Этап связки',
  Task: 'Пункт чек-листа',
  Document: 'Документ',
  Meeting: 'Встреча',
  Recommendation: 'Рекомендация',
  Application: 'Заявка на обучение',
  ITProduct: 'IT-продукт',
  DataSource: 'Источник данных',
  Export: 'Выгрузка',
  Import: 'Загрузка',
  AuditLog: 'Журнал действий',
}
