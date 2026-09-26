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
  /**
   * Превышен предел частоты запросов к API (решение 117): одна запись на ключ
   * в минуту. В payload — группа, предел и вид субъекта; адреса и пути нет.
   */
  'api.rate-limit.exceeded',
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
  /**
   * Основание обработки ПД контакта и согласие (решение 111). В журнале — коды
   * основания и статуса «было → стало», без текста документа-основания.
   */
  'contact.basis.set',
  /** Отзыв согласия: следом пишется `contact.anonymize`, если контакт обезличен. */
  'contact.consent.withdraw',
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
  /** Пользователь подключил личный чат Telegram (решение 102). Без идентификатора чата и ника. */
  'telegram.link',
  /** Чат отвязан: из личного кабинета или командой /stop. */
  'telegram.unlink',
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
  /** Справочник навыков (решение 107): в журнал пишется название — это не персональные данные. */
  'skill.create',
  'skill.update',
  /** Дубль объединён в целевой навык: objectId — целевой, в payload — удалённый и счётчики. */
  'skill.merge',
  'skill.delete',
  'export.download',
  /**
   * Запросы субъектов ПД (решение 116). objectType — User или Contact, objectId — субъект;
   * в payload — номер запроса, вид, канал и счётчики, без самих ПД.
   */
  'dsar.requested',
  'dsar.exported',
  'dsar.erased',
  'audit.retention',
  /**
   * Проверка целостности журнала (решение 115): итог, число строк, номер головы,
   * место и код нарушения. Хешей и содержимого строк в записи нет.
   */
  'audit.verify',
  'import.apply',
  /** Загрузка вендоров (решение 132): только счётчики, без ФИО и контактов. */
  'import.vendors',
  /** Загрузка заказов с сайта (решение 132): счётчики и номер загрузки, без ПД слушателей. */
  'import.site_orders',
  /** Файл «Загрузка пользователей» для LMS: сколько строк, без ПД. */
  'export.lms_users',
  'school_course.create',
  // ── Решение 123: безопасность, волна 2 ──
  /** Сменён секрет вебхука Telegram. Без самого секрета — только хост вебхука. */
  'telegram.webhook_secret_rotated',
  /** Раскрыты почта и/или телефон контакта: перечень полей и причина (почта и телефоны в ней замаскированы). */
  'contact.revealed',
  /** «Четыре глаза»: запрос на опасную операцию, одобрение, отказ, использование одобрения. */
  'approval.requested',
  'approval.approved',
  'approval.rejected',
  'approval.consumed',
  /** Выгрузка журнала для внешней системы сбора событий: курсор, число строк, последний id. */
  'audit.export',
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
  'Skill',
  'DataSource',
  'Export',
  'Import',
  'AuditLog',
  'SchoolCourse',
  'SystemSecret',
  'Approval',
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

/**
 * Нарушения цепочки журнала (решение 115) — `code` в ответе проверки.
 * Подписи — AUDIT_CHAIN_BREAK_LABELS в labels.ts; подробность — в `reason`.
 */
export const AUDIT_CHAIN_BREAK_CODES = [
  /** Пропуск номеров: строки удалены. */
  'rows_missing',
  /** Строка с номером из части, вычищенной по сроку. */
  'row_before_cut',
  /** Строка не ссылается на предыдущую: та удалена, переставлена или пересчитана. */
  'link_broken',
  /** Содержимое строки не сходится с её хешем: строка изменена. */
  'row_modified',
  /** Строка без номера или хеша: вставлена в обход триггера. */
  'row_unnumbered',
  /** Печать видела строку дальше нынешней головы: отрезан хвост журнала. */
  'tail_removed',
  /** Хеш строки печати другой: история переписана и пересчитана. */
  'history_rewritten',
  /** Проверка в базе и в приложении разошлись: функцию проверки в базе могли подменить. */
  'engines_disagree',
] as const
export type AuditChainBreakCode = (typeof AUDIT_CHAIN_BREAK_CODES)[number]

/** Печать журнала: голова цепочки на момент снятия (решение 115). */
export interface AuditSealDto {
  id: string
  /** Номер последней строки журнала; 0 — журнал был пуст. */
  headSeq: number
  /** SHA-256 этой строки, 64 шестнадцатеричных знака; null — журнал был пуст. */
  headHash: string | null
  /** Сколько строк было в журнале (после чистки по сроку меньше headSeq). */
  count: number
  at: string
}

/** Итог проверки цепочки журнала (`GET /api/audit/verify`, решение 115). */
export interface AuditChainVerifyDto {
  ok: boolean
  /** Сколько строк проверено до первого нарушения (или всего). */
  checked: number
  code: AuditChainBreakCode | null
  /** Номер строки (chain_seq), на которой найдено нарушение. */
  brokenAt: number | null
  /** id записи журнала с нарушением; у нарушений по печати — null. */
  brokenId: string | null
  /** Что не так — по-русски, готово к показу. */
  reason: string | null
  /** Номер и хеш последней проверенной строки — их можно сверить с печатью вне системы. */
  headSeq: number
  headHash: string | null
  /** С какого номера цепочка законно начинается после чистки по сроку; 0 — чистки не было. */
  anchorSeq: number
  /** Сколько печатей сверено. */
  sealsChecked: number
  /** Последняя печать; null — печатей ещё не снимали. */
  lastSeal: AuditSealDto | null
  verifiedAt: string
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
