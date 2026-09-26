/**
 * Уведомления — ответ `GET /api/notifications`, лента под колокольчиком в шапке.
 *
 * Отдельного хранилища уведомлений нет: лента собирается из того, что система
 * и так знает, — сроков этапов, истории этапов и документов, рекомендаций.
 * Поэтому она не может разойтись с данными: этап, который закрыли, перестаёт
 * быть «просроченным» и в ленте тоже.
 *
 * Прочитанность (решение 139) хранит сервер — `users.notifications_seen_at`,
 * ставится через `POST /api/notifications/seen`. Клиент может по-прежнему
 * прислать `since` (быстрый локальный кэш, обратная совместимость) — сервер
 * берёт более позднее из двух значений. В ответе — `isUnread` у каждого пункта
 * и общий `unreadCount`.
 */
export const NOTIFICATION_KINDS = [
  'stage.overdue',
  'stage.due-soon',
  'stage.changed',
  'document.changed',
  'recommendation',
] as const
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number]

/** critical — нужно действие сейчас, warning — скоро понадобится, info — к сведению. */
export type NotificationSeverity = 'critical' | 'warning' | 'info'

/**
 * К чему относится уведомление. Клик ведёт именно туда, а не на главную:
 * `type` + `id` — объект, `cooperationId` и `stageId` — уточнение для перехода
 * сразу к нужному этапу связки.
 */
export interface NotificationTargetDto {
  type: 'cooperation' | 'document' | 'recommendation'
  id: string
  cooperationId: string | null
  stageId: string | null
}

export interface NotificationDto {
  /** Постоянный: одно и то же событие приходит с тем же id при каждом запросе. */
  id: string
  kind: NotificationKind
  severity: NotificationSeverity
  title: string
  /** Где это: вуз и программа, основание рекомендации. */
  description: string | null
  /** Когда событие случилось. Для просрочки — момент, когда истёк срок. */
  occurredAt: string
  /** Новее переданного `since`. Без `since` непрочитанным считается всё. */
  isUnread: boolean
  target: NotificationTargetDto
}

export interface NotificationFeedDto {
  items: NotificationDto[]
  unreadCount: number
  generatedAt: string
}

/** Ответ `POST /api/notifications/seen` — время, которое сервер записал как отметку просмотра. */
export interface NotificationsSeenDto {
  seenAt: string
}
