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
  /**
   * Пользователя назначили (или сняли) ответственным за вуз (решение 146,
   * роль «Руководитель»). Источник — журнал действий (audit.university.responsible.set),
   * а не отдельная таблица (тот же приём, что у остальной ленты).
   */
  'university.responsible-changed',
  /**
   * Назначили (или сняли) ответственным за связку или за этап (решение 205).
   * Источник — журнал действий: `cooperation.responsible.set`, `stage.responsible.set`.
   * Новому ответственному то же событие уходит и в подключённый мессенджер.
   */
  'cooperation.responsible-changed',
  'stage.responsible-changed',
  /**
   * Поручения (решение 207): новое поручение от руководителя, срок завтра, срок прошёл.
   * Источник — таблица `assignments` (открытые поручения пользователя). Новое поручение
   * уходит и в подключённый мессенджер — без текста, только вуз и срок.
   */
  'assignment.new',
  'assignment.due-soon',
  'assignment.overdue',
  /**
   * Новое письмо вуза ждёт разбора (решение 213) — тем, кто разбирает письма
   * (ADMIN, HEAD). То же событие, что уходит им в Telegram (решение 183), и с той же
   * кнопкой «Принять в работу» (`accept`). Источник — сами письма в статусах
   * «Новое» и «Разобрано»: проверенное письмо из ленты уходит.
   */
  'letter.new',
  /**
   * «Четыре глаза» (решения 133, 218): запрос ждёт решения этого администратора —
   * чужой, ещё без решения и не истёкший. Источник — таблица `approvals`.
   */
  'approval.requested',
  /**
   * По своему запросу есть решение: согласовано — осталось выполнить, или отклонено.
   * Только автору запроса; выполненный (`CONSUMED`) из ленты уходит.
   */
  'approval.decided',
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
  type: 'cooperation' | 'document' | 'recommendation' | 'university' | 'assignment' | 'letter' | 'approval'
  id: string
  cooperationId: string | null
  stageId: string | null
}

/**
 * Кнопка «Принять в работу» у пункта ленты (решение 213) — то же, что «✓ Принял»
 * в Telegram: `POST /api/inbound-letters/:id/accept`.
 */
export interface NotificationAcceptDto {
  type: 'letter'
  id: string
  /** Этот пользователь уже принял — вместо кнопки строка «Вы приняли в работу». */
  acceptedByMe: boolean
  /** Кто уже принял (первый по времени), если не этот пользователь; null — никто. */
  acceptedByName: string | null
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
  /** Есть только у пунктов, которые можно принять в работу прямо из ленты. */
  accept?: NotificationAcceptDto
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
