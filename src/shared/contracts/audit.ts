import type { UserRefDto } from './workflow'

/**
 * Действия, которые журналируются (раздел 15 ТЗ). Список расширяется по мере надобности.
 *
 * Список здесь, а не в `shared/audit`: вкладка «Журнал действий» строит по нему
 * фильтр и подписи (AUDIT_ACTION_LABELS), а тип `AuditAction` журнала берётся
 * отсюда — действие без подписи не соберётся.
 */
export const AUDIT_ACTIONS = [
  'auth.login.success',
  'auth.login.failure',
  'auth.login.blocked',
  'user.create',
  /** ФИО, должность или вуз представителя. В журнале — только имена полей. */
  'user.update',
  'user.role.change',
  'user.block',
  'user.unblock',
  /** Администратор выдал новый временный пароль. Сам пароль не пишется. */
  'user.password.reset',
  /** Пользователь сменил свой пароль. */
  'user.password.change',
  /** Выпущена или перевыпущена ссылка на календарь (решение 105). Без токена. */
  'calendar.issue',
  /** Ссылка на календарь отозвана. */
  'calendar.revoke',
  'university.create',
  'university.update',
  'university.archive',
  'university.restore',
  'contact.anonymize',
  'program.create',
  'program.update',
  'program.skills.replace',
  'program.archive',
  'program.restore',
  'cooperation.create',
  'cooperation.update',
  'stage.status.change',
  'stage.fields.change',
  'stage.auto.recompute',
  'task.toggle',
  /**
   * Сотрудник отметил за вуз пункт «Вуз подтвердил получение материалов» — у вуза
   * нет представителя (решение 103). В журнале — длина пометки, не её текст.
   */
  'task.university-item.confirm-by-staff',
  'application.create',
  'recommendation.generate',
  'recommendation.status.change',
  /** Черновик ИИ-помощника: вид, объект, провайдер, модель или шаблон. Без текста. */
  'ai.draft',
  'document.create',
  'document.update',
  'document.status.change',
  'document.version.create',
  'document.package.generate',
  'meeting.create',
  'meeting.update',
  'portal.material.confirm',
  'portal.metrics.update',
  'datasource.sync',
  'product.create',
  'product.update',
  'product.skills.replace',
  'product.version.release',
  'export.download',
  'audit.retention',
  'import.apply',
] as const
export type AuditActionCode = (typeof AUDIT_ACTIONS)[number]

/**
 * Типы объектов в журнале — значения `objectType`, которые пишут модули.
 * Подписи — AUDIT_OBJECT_TYPE_LABELS; фильтр вкладки журнала строится по ним.
 */
export const AUDIT_OBJECT_TYPES = [
  'User',
  'University',
  'Contact',
  'EducationalProgram',
  'Cooperation',
  'WorkflowStage',
  'Task',
  'Document',
  'Meeting',
  'Recommendation',
  'Application',
  'ITProduct',
  'DataSource',
  'Export',
  'Import',
  'AuditLog',
] as const
export type AuditObjectType = (typeof AUDIT_OBJECT_TYPES)[number]

/** Запись журнала критичных действий (раздел 15 ТЗ). Доступна только администратору. */
export interface AuditLogEntryDto {
  id: string
  action: string
  objectType: string
  objectId: string
  /** Служебные поля действия. Персональных данных здесь нет. */
  payload: Record<string, unknown> | null
  user: UserRefDto | null
  /**
   * Связка, к которой относится объект, — для этапа и пункта чек-листа:
   * у них нет своей страницы, открываются они на странице связки.
   * У остальных объектов — null.
   */
  cooperationId: string | null
  createdAt: string
}

export type UniversityEventKind =
  | 'cooperation.created'
  | 'stage.status'
  | 'document.status'
  | 'meeting'
  | 'application'

/**
 * Больше событий лента вуза за один запрос не отдаёт. Общая константа для схемы
 * и страницы: «Показать ещё» прибавлял по 20 без предела, и на 120 вкладка
 * истории сменялась ошибкой проверки.
 */
export const UNIVERSITY_EVENTS_MAX_LIMIT = 100

/**
 * Событие в ленте вуза (раздел 7.3 ТЗ, «Последние события»).
 *
 * Лента собирается из доменных данных — истории этапов, истории документов, встреч и заявок,
 * а не из технического журнала: человеку нужен рассказ о работе, а не список действий системы.
 */
export interface UniversityEventDto {
  id: string
  kind: UniversityEventKind
  /** Короткая формулировка для ленты. */
  title: string
  /** Подробности: результат этапа, тема встречи, комментарий. */
  details: string | null
  cooperationId: string | null
  programName: string | null
  author: UserRefDto | null
  occurredAt: string
}
