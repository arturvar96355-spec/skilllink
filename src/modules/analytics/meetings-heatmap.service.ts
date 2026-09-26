import { z } from '@/shared/zod'
import { assertCan, universityScope } from '@/shared/auth/permissions'
import type { CurrentUser } from '@/shared/auth/current-user'
import { intersectUniversityFilter } from '@/shared/auth/scope'
import { MEETINGS_HEATMAP } from '@/shared/config/data-quality.config'
import type { MeetingsHeatmapDto } from '@/shared/contracts/data-quality'
import { validationError } from '@/shared/http/errors'
import { findHeldMeetings } from './meetings-heatmap.repo'
import { buildHeatmap, DAY_LABELS } from './meetings-heatmap.rules'

const isoDate = z.iso.datetime({ message: 'Дата должна быть в формате ISO 8601' })

export const meetingsHeatmapQuerySchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  universityId: z.string().trim().min(1).optional(),
})

export type MeetingsHeatmapQuery = z.infer<typeof meetingsHeatmapQuerySchema>

/**
 * Тепловая карта проведённых встреч (решение 134): когда реально встречаются с вузами.
 * Проведённая — дата встречи не позже «сейчас» (и не позже `to`). Право ANALYTICS;
 * область видимости — общим хелпером: представителю вуза (если право ему дадут) —
 * только его вуз, запрос чужого — пустая карта, а не чужие данные.
 */
export async function meetingsHeatmap(
  user: CurrentUser,
  query: MeetingsHeatmapQuery,
  now: Date = new Date(),
): Promise<MeetingsHeatmapDto> {
  assertCan(user, 'ANALYTICS')
  const from = query.from ? new Date(query.from) : null
  const requestedTo = query.to ? new Date(query.to) : now
  const to = requestedTo.getTime() > now.getTime() ? now : requestedTo
  if (from && from.getTime() > to.getTime()) {
    throw validationError('Начало периода позже конца', [{ field: 'from', message: 'Укажите дату не позже конца периода' }])
  }

  const filter = intersectUniversityFilter(universityScope(user), query.universityId)
  const meetings = filter === null ? [] : await findHeldMeetings(filter, from, to)
  const cells = buildHeatmap(meetings.map((meeting) => meeting.date))
  return {
    cells,
    dayLabels: [...DAY_LABELS],
    timeZone: MEETINGS_HEATMAP.timeZone,
    total: meetings.length,
    max: Math.max(0, ...cells.flat()),
    from: from?.toISOString() ?? null,
    to: to.toISOString(),
    isMock: meetings.some((meeting) => meeting.isMock),
  }
}
