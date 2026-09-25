import { assertCan, can } from '@/shared/auth/permissions'
import { writeAudit } from '@/shared/audit/audit'
import { CALENDAR_FEED } from '@/shared/config/calendar.config'
import { notFound } from '@/shared/http/errors'
import { addDays } from '@/shared/utils/date'
import type { CurrentUser } from '@/shared/auth/current-user'
import type {
  CalendarFeedStatusDto,
  IssuedCalendarFeedDto,
  RevokedCalendarFeedDto,
} from '@/shared/contracts/calendar'
import * as repo from './calendar.repo'
import {
  feedUrl,
  generateFeedToken,
  hashFeedToken,
  limitEvents,
  meetingEvent,
  publicBaseUrl,
  renderCalendar,
  stageEvent,
  toWebcal,
  tokenFromFileName,
} from './calendar.rules'

/**
 * Личная подписка на календарь сроков и встреч (решение 105).
 *
 * Ссылка на ленту работает без входа — календарные приложения cookie не шлют.
 * Поэтому ссылка и есть доступ: в базе только хеш токена, сам адрес отдаётся
 * один раз при выпуске, перевыпуск и отзыв сразу закрывают прежний адрес.
 */

export async function status(user: CurrentUser): Promise<CalendarFeedStatusDto> {
  assertCan(user, 'CALENDAR')
  const row = await repo.findStatus(user.id)
  return { active: row !== null, createdAt: row ? row.createdAt.toISOString() : null }
}

export async function issue(user: CurrentUser): Promise<IssuedCalendarFeedDto> {
  assertCan(user, 'CALENDAR')

  const token = generateFeedToken()
  const { createdAt, replaced } = await repo.replace(user.id, hashFeedToken(token), new Date())

  // Ни токена, ни хеша в журнале: запись журнала читает администратор, а не владелец ссылки.
  await writeAudit({
    userId: user.id,
    action: 'calendar.issue',
    objectType: 'User',
    objectId: user.id,
    payload: { replaced },
  })

  const url = feedUrl(publicBaseUrl(process.env), token)
  return { url, webcalUrl: toWebcal(url), createdAt: createdAt.toISOString(), replaced }
}

export async function revoke(user: CurrentUser): Promise<RevokedCalendarFeedDto> {
  assertCan(user, 'CALENDAR')
  const revoked = await repo.remove(user.id)
  if (revoked) {
    await writeAudit({ userId: user.id, action: 'calendar.revoke', objectType: 'User', objectId: user.id })
  }
  return { revoked }
}

/** Одинаковый ответ на любую неудачу: по нему не узнать, был ли такой токен. */
const feedNotFound = () => notFound('Календарь не найден')

/**
 * Лента по адресу `<токен>.ics`. Неизвестный токен, отозванная ссылка,
 * заблокированный владелец и владелец, которому подписка больше не положена
 * (роль сменилась на представителя вуза), — одинаково 404.
 */
export async function renderFeed(fileName: string, now = new Date()): Promise<string> {
  const token = tokenFromFileName(fileName)
  if (token === null) throw feedNotFound()

  const owner = await repo.findOwnerByHash(hashFeedToken(token))
  if (!owner || !owner.isActive || !can(owner, 'CALENDAR')) throw feedNotFound()

  const [deadlines, meetings] = await Promise.all([
    repo.findDeadlines(owner.id, now, CALENDAR_FEED.maxEvents),
    repo.findMeetings(owner.id, now, addDays(now, -CALENDAR_FEED.pastMeetingsDays), CALENDAR_FEED.maxEvents),
  ])

  const baseUrl = publicBaseUrl(process.env)
  const events = limitEvents(
    [
      ...deadlines.map((item) => stageEvent(item, baseUrl, now)),
      ...meetings.map((item) => meetingEvent(item, baseUrl, CALENDAR_FEED.meetingDurationMinutes)),
    ],
    CALENDAR_FEED.maxEvents,
    now,
  )

  return renderCalendar(events, {
    name: 'SkillLink — сроки и встречи',
    now,
    refreshIntervalHours: CALENDAR_FEED.refreshIntervalHours,
  })
}
