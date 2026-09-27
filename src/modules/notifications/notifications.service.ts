import { assertCan, can } from '@/shared/auth/permissions'
import type { CurrentUser } from '@/shared/auth/current-user'
import { NOTIFICATION_WINDOW_DAYS } from '@/shared/config/notifications.config'
import { validationError } from '@/shared/http/errors'
import type { NotificationFeedDto, NotificationsSeenDto } from '@/shared/contracts/notification'
import { log } from '@/shared/log/logger'
import { publicBaseUrl } from '@/shared/config/public-url'
import { sendToUser } from '@/modules/notify-channels/notify-channels.service'
import * as repo from './notifications.repo'
import { buildFeed } from './notifications.rules'
import { buildAssignmentNotice, shouldNotifyAssignment, type ResponsibleChange } from './notifications.assignment'
import type { MarkNotificationsSeenInput, NotificationFeedQuery } from './notifications.schema'

const DAY_MS = 24 * 60 * 60 * 1000

/** Более позднее из двух времён; `null` — «нет отметки». */
function laterOf(a: Date | null, b: Date | null): Date | null {
  if (a === null) return b
  if (b === null) return a
  return a.getTime() > b.getTime() ? a : b
}

/**
 * Лента уведомлений текущего пользователя.
 *
 * Отдельной таблицы уведомлений нет — лента собирается из данных на лету,
 * поэтому не расходится с ними и не требует изменения схемы под сами данные.
 *
 * Прочитанность (решение 139) хранится на сервере, в `users.notifications_seen_at`,
 * и это источник истины: смена браузера или устройства и очистка localStorage
 * больше не сбрасывают её. Клиент может по-прежнему прислать `since` (старый фронт,
 * быстрый локальный кэш) — используется более позднее из двух значений, так что
 * подсказка клиента никогда не делает ленту «более прочитанной», чем на сервере.
 */
export async function feed(user: CurrentUser, query: NotificationFeedQuery): Promise<NotificationFeedDto> {
  assertCan(user, 'READ')

  const now = new Date()
  const windowStart = new Date(now.getTime() - NOTIFICATION_WINDOW_DAYS * DAY_MS)

  // Письма вузов (решение 213) — только тем, кто их разбирает: им же уходит
  // уведомление о новом письме в Telegram (решение 183). Эксперту — нет: кнопка
  // «Принять в работу» ему недоступна (решение 147), как и разбор письма.
  const canTakeLetters = can(user, 'INBOUND_REVIEW') && !user.isReviewer
  const lettersPromise = canTakeLetters ? repo.loadNewLetters(user.id, windowStart) : Promise.resolve([])

  const [sources, serverSeenAt, letters] = await Promise.all([
    user.role === 'UNIVERSITY_REP'
      ? user.universityId
        ? repo.loadForUniversity(user.universityId, user.id, windowStart)
        : Promise.resolve({
            deadlines: [],
            stageChanges: [],
            documentChanges: [],
            recommendations: [],
            responsibleAssignments: [],
            assignments: [],
          })
      : repo.loadForStaff(user.id, windowStart, can(user, 'ANALYTICS')),
    repo.getSeenAt(user.id),
    lettersPromise,
  ])

  const clientSince = query.since ? new Date(query.since) : null

  return buildFeed(letters.length > 0 ? { ...sources, letters } : sources, {
    now,
    since: laterOf(clientSince, serverSeenAt),
    limit: query.limit,
  })
}

/**
 * Отмечает ленту уведомлений просмотренной (решение 139): `POST /api/notifications/seen`.
 *
 * Без `seenAt` — серверное «сейчас». С `seenAt` — переданное время, если оно не в
 * будущем: будущая отметка скрыла бы события, которые ещё не случились, как только
 * до них дойдёт время.
 */
export async function markSeen(
  user: CurrentUser,
  input: MarkNotificationsSeenInput,
): Promise<NotificationsSeenDto> {
  assertCan(user, 'READ')

  const now = new Date()
  let seenAt = now
  if (input.seenAt) {
    const provided = new Date(input.seenAt)
    if (provided.getTime() > now.getTime()) {
      throw validationError('Отметка просмотра не может быть в будущем', [
        { field: 'seenAt', message: 'Не может быть позже текущего времени сервера' },
      ])
    }
    seenAt = provided
  }

  await repo.setSeenAt(user.id, seenAt)
  return { seenAt: seenAt.toISOString() }
}

// ───────────────────── Назначение ответственным → мессенджер (решение 205) ─────────────────────

/** Чем кончилась попытка: для журнала и тестов. */
export type AssignmentNoticeOutcome = 'skipped' | 'sent' | 'not-delivered' | 'failed'

/**
 * Отправить новому ответственному «Вас назначили ответственным…» через его канал
 * (`sendToUser`, решение 144: основной канал, затем остальные привязанные). Ничего не
 * подключено — тихо не уходит, как сводка и письмо вуза. Не бросает: назначение уже
 * записано, сбой мессенджера — только строка в журнале приложения (без ФИО и текста).
 */
export async function sendAssignmentNotice(
  change: ResponsibleChange,
  now: Date = new Date(),
): Promise<AssignmentNoticeOutcome> {
  if (!shouldNotifyAssignment(change)) return 'skipped'
  try {
    const context = await repo.loadAssignmentContext(change.scope, change.objectId)
    if (!context) return 'skipped'
    const message = buildAssignmentNotice(context, { now, baseUrl: publicBaseUrl() })
    const result = await sendToUser(change.responsibleId, message)
    log.info('[notifications] уведомление о назначении ответственным', {
      scope: change.scope,
      objectId: change.objectId,
      sent: result.sent,
      channel: result.channel,
    })
    return result.sent ? 'sent' : 'not-delivered'
  } catch (error) {
    log.warn('[notifications] уведомление о назначении ответственным не отправлено', {
      scope: change.scope,
      objectId: change.objectId,
      err: error,
    })
    return 'failed'
  }
}

/**
 * Для сервисов связок, этапов и вузов: вызывать ПОСЛЕ успешной записи. Ответ PATCH
 * мессенджер не ждёт — отправка идёт в фоне, её ошибка назначение не откатывает.
 */
export function notifyResponsibleAssigned(change: ResponsibleChange): void {
  if (!shouldNotifyAssignment(change)) return
  void sendAssignmentNotice(change)
}
