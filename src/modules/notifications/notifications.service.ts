import { assertCan, can } from '@/shared/auth/permissions'
import type { CurrentUser } from '@/shared/auth/current-user'
import { NOTIFICATION_WINDOW_DAYS } from '@/shared/config/notifications.config'
import type { NotificationFeedDto } from '@/shared/contracts/notification'
import * as repo from './notifications.repo'
import { buildFeed } from './notifications.rules'
import type { NotificationFeedQuery } from './notifications.schema'

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Лента уведомлений текущего пользователя.
 *
 * Отдельной таблицы уведомлений нет — лента собирается из данных на лету,
 * поэтому не расходится с ними и не требует изменения схемы. Прочитанность
 * хранит фронт (см. контракт `NotificationFeedDto`).
 */
export async function feed(user: CurrentUser, query: NotificationFeedQuery): Promise<NotificationFeedDto> {
  assertCan(user, 'READ')

  const now = new Date()
  const windowStart = new Date(now.getTime() - NOTIFICATION_WINDOW_DAYS * DAY_MS)

  const sources =
    user.role === 'UNIVERSITY_REP'
      ? user.universityId
        ? await repo.loadForUniversity(user.universityId, user.id, windowStart)
        : { deadlines: [], stageChanges: [], documentChanges: [], recommendations: [] }
      : await repo.loadForStaff(user.id, windowStart, can(user, 'ANALYTICS'))

  return buildFeed(sources, {
    now,
    since: query.since ? new Date(query.since) : null,
    limit: query.limit,
  })
}
