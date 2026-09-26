import type { ApprovalAction, ApprovalStatus } from './approval'
import type {
  DsarRequestChannel,
  DsarRequestKind,
  DsarRequestStatus,
  DsarSubjectType,
} from './dsar'
import type {
  ApplicationStatus,
  ConfidenceLevel,
  ConsentForm,
  ConsentStatus,
  ContactLegalBasis,
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
  VendorContactChannel,
} from './enums'
import type { AuditActionCode, AuditChainBreakCode, AuditObjectType } from './audit'

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

/** Правовое основание обработки ПД контакта вуза (решение 111) — со ссылкой на пункт закона. */
export const CONTACT_LEGAL_BASIS_LABELS: Record<ContactLegalBasis, string> = {
  LEGITIMATE_INTEREST: 'Законный интерес: договор с вузом (п. 7 ч. 1 ст. 6 152-ФЗ)',
  CONTRACT: 'Договор, стороной которого является сам контакт (п. 5 ч. 1 ст. 6 152-ФЗ)',
  CONSENT: 'Согласие субъекта (п. 1 ч. 1 ст. 6 152-ФЗ)',
  OTHER: 'Иное основание ст. 6 152-ФЗ — по документу',
}

export const CONSENT_STATUS_LABELS: Record<ConsentStatus, string> = {
  NONE: 'Не требуется',
  OBTAINED: 'Согласие получено',
  WITHDRAWN: 'Согласие отозвано',
}

export const CONSENT_FORM_LABELS: Record<ConsentForm, string> = {
  WRITTEN: 'Письменное',
  ELECTRONIC: 'Электронное',
  ORAL_CONFIRMED_BY_EMAIL: 'Устное, подтверждено письмом по почте',
}

/** Канал связи с контактом вендора (решение 132) — как в колонке «Способ связи» файла вендоров. */
export const VENDOR_CONTACT_CHANNEL_LABELS: Record<VendorContactChannel, string> = {
  EMAIL: 'Почта',
  TELEGRAM: 'Чат в Telegram',
  PHONE: 'Телефон',
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
  'api.rate-limit.exceeded': 'Превышен предел частоты запросов',
  'user.create': 'Заведён пользователь',
  'user.update': 'Изменены данные пользователя',
  'user.role.change': 'Изменена роль пользователя',
  'user.block': 'Пользователь заблокирован',
  'user.unblock': 'Пользователь разблокирован',
  'user.password.reset': 'Выдан временный пароль',
  'user.password.change': 'Пользователь сменил пароль',
  'calendar.issue': 'Выпущена ссылка на календарь',
  'calendar.revoke': 'Отозвана ссылка на календарь',
  'university.create': 'Создан вуз',
  'university.update': 'Изменён вуз',
  'university.archive': 'Вуз отправлен в архив',
  'university.restore': 'Вуз возвращён из архива',
  'university.merge': 'Вуз-дубль слит с другим',
  'university.merge.undo': 'Отменено слияние вузов',
  'duplicate.dismiss': 'Пара отмечена «не дубль»',
  'contact.anonymize': 'Контакт вуза обезличен',
  'contact.basis.set': 'Зафиксировано основание обработки ПД контакта',
  'contact.consent.withdraw': 'Отозвано согласие контакта на обработку ПД',
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
  'task.university-item.confirm-by-staff': 'Сотрудник отметил подтверждение вуза с пометкой',
  'application.create': 'Подана заявка на обучение',
  'recommendation.generate': 'Пересобраны рекомендации',
  'recommendation.status.change': 'Изменён статус рекомендации',
  'ai.draft': 'Черновик ИИ-помощника',
  'ai.story': 'История сотрудничества (ИИ)',
  'ai.request': 'Обращение к модели ИИ',
  'ai.proposal.created': 'План предложен (ИИ)',
  'ai.proposal.applied': 'План применён',
  'telegram.link': 'Подключены уведомления в Telegram',
  'telegram.unlink': 'Отключены уведомления в Telegram',
  'channel.link': 'Подключён канал уведомлений (MAX/VK)',
  'channel.unlink': 'Отключён канал уведомлений (MAX/VK)',
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
  'skill.create': 'Добавлен навык',
  'skill.update': 'Изменён навык',
  'skill.merge': 'Навык-дубль объединён с другим',
  'skill.delete': 'Удалён навык',
  'export.download': 'Выгрузка в CSV',
  'dsar.requested': 'Зарегистрирован запрос субъекта ПД',
  'dsar.exported': 'Выгрузка «всё о субъекте» ПД',
  'dsar.erased': 'Обезличивание по запросу субъекта ПД',
  'audit.retention': 'Очистка журнала по сроку хранения',
  'audit.verify': 'Проверка целостности журнала',
  'import.apply': 'Загрузка реестра из CSV',
  'forecast.model.train': 'Обучена модель прогноза связок',
  'import.vendors': 'Загрузка вендоров и их контактов',
  'import.site_orders': 'Загрузка заказов с сайта',
  'export.lms_users': 'Файл «Загрузка пользователей» для LMS',
  'school_course.create': 'Заведён курс ИТ-Школы',
  'telegram.webhook_secret_rotated': 'Сменён секрет вебхука Telegram',
  'contact.revealed': 'Раскрыты почта или телефон контакта',
  'approval.requested': 'Запрошено одобрение опасной операции',
  'approval.approved': 'Операция одобрена вторым администратором',
  'approval.rejected': 'В одобрении операции отказано',
  'approval.consumed': 'Одобрение использовано',
  'audit.export': 'Выгрузка журнала для внешней системы',
  'telegram.token_changed': 'Сменён токен бота Telegram',
  'telegram.token_removed': 'Бот Telegram отключён (токен удалён)',
  'telegram.mode_switched': 'Изменён режим приёма обновлений Telegram',
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
  Skill: 'Навык',
  DataSource: 'Источник данных',
  Export: 'Выгрузка',
  Import: 'Загрузка',
  AuditLog: 'Журнал действий',
  ForecastModel: 'Модель прогноза',
  DuplicateDismissal: 'Отметка «не дубль»',
  SchoolCourse: 'Курс ИТ-Школы',
  SystemSecret: 'Секрет системы',
  Approval: 'Одобрение операции',
}

/** Статус запроса на одобрение (решение 133). */
export const APPROVAL_STATUS_LABELS: Record<ApprovalStatus, string> = {
  REQUESTED: 'Ждёт одобрения',
  APPROVED: 'Одобрено',
  REJECTED: 'Отклонено',
  CONSUMED: 'Использовано',
  EXPIRED: 'Истёк срок',
}

/** Операция, которой нужно одобрение второго администратора (решение 133). */
export const APPROVAL_ACTION_LABELS: Record<ApprovalAction, string> = {
  'user.grant_admin': 'Назначить администратором',
  'user.block_admin': 'Заблокировать администратора',
}

/**
 * Нарушение цепочки журнала — коротко, для значка рядом с кнопкой проверки
 * (решение 115). Подробность с номерами строк — в `reason` ответа.
 */
export const AUDIT_CHAIN_BREAK_LABELS: Record<AuditChainBreakCode, string> = {
  rows_missing: 'Удалены записи',
  row_before_cut: 'Запись из вычищенной части',
  link_broken: 'Разрыв цепочки',
  row_modified: 'Запись изменена',
  row_unnumbered: 'Запись в обход цепочки',
  tail_removed: 'Удалены последние записи',
  history_rewritten: 'История переписана',
  engines_disagree: 'Проверки разошлись',
}

/** Запросы субъектов ПД (решение 116). */
export const DSAR_SUBJECT_TYPE_LABELS: Record<DsarSubjectType, string> = {
  USER: 'Пользователь системы',
  CONTACT: 'Контактное лицо вуза',
}

export const DSAR_REQUEST_KIND_LABELS: Record<DsarRequestKind, string> = {
  EXPORT: 'Сведения о ПД (ст. 14)',
  ERASE: 'Уничтожение ПД (ст. 20, 21)',
}

export const DSAR_REQUEST_STATUS_LABELS: Record<DsarRequestStatus, string> = {
  OPEN: 'Открыт',
  COMPLETED: 'Исполнен',
}

export const DSAR_REQUEST_CHANNEL_LABELS: Record<DsarRequestChannel, string> = {
  SELF_SERVICE: 'Сам в личном кабинете',
  LETTER: 'Письмо субъекта',
  ADMIN: 'Администратор без письма',
}
