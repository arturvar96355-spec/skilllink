import type { UserRefDto } from './workflow'

/** Запись журнала критичных действий (раздел 15 ТЗ). Доступна только администратору. */
export interface AuditLogEntryDto {
  id: string
  action: string
  objectType: string
  objectId: string
  /** Служебные поля действия. Персональных данных здесь нет. */
  payload: Record<string, unknown> | null
  user: UserRefDto | null
  createdAt: string
}

export type UniversityEventKind =
  | 'cooperation.created'
  | 'stage.status'
  | 'document.status'
  | 'meeting'
  | 'application'

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
