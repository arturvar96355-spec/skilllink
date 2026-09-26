import { describe, expect, it } from 'vitest'
import {
  currentStageOf,
  featuresAt,
  isEligible,
  labelAt,
  snapshotDates,
  stageStatuses,
  truncateTimeline,
  type CooperationTimeline,
} from './forecast-features'
import type { StageMedians } from './stage-duration'
import { FORECAST_MILESTONES } from '@/shared/config/forecast.config'

const DAY_MS = 24 * 60 * 60 * 1000
const day = (n: number) => new Date(Date.UTC(2026, 0, 1) + n * DAY_MS)

/** Медианы-заглушка: 20 дней на любой этап — признакам это не важно, важна сама формула. */
const MEDIANS: StageMedians = { medianDays: () => 20, toJSON: () => ({}) }

function baseTimeline(): CooperationTimeline {
  return {
    id: 'coop-1',
    universityId: 'uni-1',
    region: 'Москва',
    programLevel: 'BACHELOR',
    startedAt: day(0),
    closedAt: null,
    isMock: true,
    stageEvents: [
      { stageNumber: 1, toStatus: 'IN_PROGRESS', at: day(0) },
      { stageNumber: 1, toStatus: 'COMPLETED', at: day(5) },
      { stageNumber: 2, toStatus: 'IN_PROGRESS', at: day(5) },
    ],
    tasks: [{ stageNumber: 2, doneAt: day(6) }],
    meetings: [day(2), day(6)],
    documentEvents: [{ documentId: 'doc-1', toStatus: 'REVIEW', at: day(6) }],
    dismissedRecommendations: [day(3)],
  }
}

describe('признаки не видят будущего', () => {
  it('одинаковые признаки на t независимо от того, что случится после t', () => {
    const t = day(10)
    const early = baseTimeline()
    const withFuture: CooperationTimeline = {
      ...early,
      stageEvents: [
        ...early.stageEvents,
        { stageNumber: 2, toStatus: 'COMPLETED', at: day(20) },
        { stageNumber: 3, toStatus: 'IN_PROGRESS', at: day(20) },
      ],
      tasks: [...early.tasks, { stageNumber: 3, doneAt: day(21) }],
      meetings: [...early.meetings, day(15), day(30)],
      documentEvents: [...early.documentEvents, { documentId: 'doc-2', toStatus: 'SIGNED', at: day(25) }],
      dismissedRecommendations: [...early.dismissedRecommendations, day(18)],
      closedAt: day(40),
    }

    const featuresEarly = featuresAt(truncateTimeline(early, t), [], t, MEDIANS)
    const featuresFuture = featuresAt(truncateTimeline(withFuture, t), [], t, MEDIANS)

    expect(featuresEarly).not.toBeNull()
    expect(featuresFuture).toEqual(featuresEarly)
  })

  it('обрезанная история не содержит событий позже t и не знает о закрытии позже t', () => {
    const t = day(10)
    const timeline = baseTimeline()
    const withClose: CooperationTimeline = { ...timeline, closedAt: day(15) }

    const truncated = truncateTimeline(withClose, t)
    expect(truncated.closedAt).toBeNull()
    expect(truncated.stageEvents.every((event) => event.at.getTime() <= t.getTime())).toBe(true)
  })

  it('метка смотрит только вперёд от t на горизонт H — событие после границы не в счёт', () => {
    const milestone = FORECAST_MILESTONES[0]!
    const timeline = baseTimeline()
    const t = day(0)
    const signedRightAfterHorizon: CooperationTimeline = {
      ...timeline,
      stageEvents: [
        ...timeline.stageEvents,
        { stageNumber: milestone.stageNumber, toStatus: 'COMPLETED', at: day(milestone.horizonDays + 1) },
      ],
    }
    const signedInsideHorizon: CooperationTimeline = {
      ...timeline,
      stageEvents: [
        ...timeline.stageEvents,
        { stageNumber: milestone.stageNumber, toStatus: 'COMPLETED', at: day(milestone.horizonDays) },
      ],
    }
    expect(labelAt(signedRightAfterHorizon, t, milestone)).toBe(0)
    expect(labelAt(signedInsideHorizon, t, milestone)).toBe(1)
  })
})

describe('текущий этап и право на прогноз', () => {
  it('текущий этап — первый незакрытый из 1..13', () => {
    const timeline = baseTimeline()
    const statuses = stageStatuses(timeline)
    expect(currentStageOf(statuses)).toBe(2)
  })

  it('связка не годится для прогноза вехи, которая уже достигнута', () => {
    const milestone = { stageNumber: 2, horizonDays: 30, goal: 'теста' }
    const timeline = truncateTimeline(baseTimeline(), day(10))
    // Этап 2 ещё не завершён в этой истории — годится.
    expect(isEligible(timeline, day(10), milestone, null)).toBe(true)

    const reached: CooperationTimeline = {
      ...timeline,
      stageEvents: [...timeline.stageEvents, { stageNumber: 2, toStatus: 'COMPLETED', at: day(9) }],
    }
    expect(isEligible(reached, day(10), milestone, null)).toBe(false)
  })

  it('закрытая связка не годится ни для одной вехи', () => {
    const milestone = FORECAST_MILESTONES[0]!
    const closed: CooperationTimeline = { ...baseTimeline(), closedAt: day(8) }
    expect(isEligible(closed, day(10), milestone, null)).toBe(false)
  })
})

describe('даты снимков — без взгляда в будущее', () => {
  it('последний снимок — не позже now минус горизонт (правое цензурирование)', () => {
    const milestone = FORECAST_MILESTONES[0]!
    const now = day(100)
    const dates = snapshotDates([baseTimeline()], now, milestone)
    const last = dates[dates.length - 1]!
    expect(last.getTime()).toBeLessThanOrEqual(now.getTime() - milestone.horizonDays * DAY_MS)
  })
})
