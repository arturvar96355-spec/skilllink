import { assertCan, can } from '@/shared/auth/permissions'
import type { CurrentUser } from '@/shared/auth/current-user'
import { NOTIFICATION_WINDOW_DAYS } from '@/shared/config/notifications.config'
import { validationError } from '@/shared/http/errors'
import type { NotificationFeedDto, NotificationsSeenDto } from '@/shared/contracts/notification'
import * as repo from './notifications.repo'
import { buildFeed } from './notifications.rules'
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

  const [sources, serverSeenAt] = await Promise.all([
    user.role === 'UNIVERSITY_REP'
      ? user.universityId
        ? repo.loadForUniversity(user.universityId, user.id, windowStart)
        : Promise.resolve({ deadlines: [], stageChanges: [], documentChanges: [], recommendations: [] })
      : repo.loadForStaff(user.id, windowStart, can(user, 'ANALYTICS')),
    repo.getSeenAt(user.id),
  ])

  const clientSince = query.since ? new Date(query.since) : null

  return buildFeed(sources, {
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
