import { universityScope } from '@/shared/auth/permissions'
import type { CurrentUser } from '@/shared/auth/current-user'
import { INSIGHTS } from '@/shared/config/analytics.config'
import { describeForLog } from '@/shared/db/log'
import { moscowDayStart } from '@/shared/utils/date'
import * as repo from './stage-analytics.repo'
import { computeInsights, stalledStates } from './stage-analytics.service'
import { getStalledThreshold } from './stalled-threshold'
import type { PulseExtras, PulseMeetingSource } from './pulse.rules'

/**
 * То, что пульс (решение 120) добавляет к прежней сводке «что горит у меня»:
 * застрявшие связки пользователя, его встречи, успехи за сутки, «Система заметила».
 *
 * Отдельный файл — чтобы сводка в Telegram и её тесты подменяли расширения одной
 * точкой. Не бросает: сбой расширений не должен ронять ни страницу, ни рассылку —
 * тогда пульс собирается из этапов и рекомендаций, как раньше (null).
 */

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * «Система заметила» — общее для всех сотрудников: рассылка сводок не пересчитывает
 * его заново для каждого получателя. Живёт минуту.
 */
const INSIGHTS_TTL_MS = 60_000
let insightsMemo: { key: string; at: number; value: Promise<Awaited<ReturnType<typeof computeInsights>>> } | null =
  null

function sharedInsights(scope: { universityId?: string }, now: Date) {
  const key = scope.universityId ?? '*'
  if (!insightsMemo || insightsMemo.key !== key || now.getTime() - insightsMemo.at > INSIGHTS_TTL_MS) {
    const value = computeInsights(scope, now)
    insightsMemo = { key, at: now.getTime(), value }
    // Сбой не запоминается: следующий вызов посчитает заново.
    value.catch(() => {
      if (insightsMemo?.value === value) insightsMemo = null
    })
  }
  return insightsMemo.value
}

function meetingSource(row: repo.PulseMeetingRow): PulseMeetingSource {
  const university = row.cooperation?.university ?? row.university
  const universityName = university ? (university.shortName ?? university.name) : null
  const label = row.cooperation
    ? `${universityName} — ${row.cooperation.program.name}`
    : (universityName ?? 'без вуза')
  return {
    meetingId: row.id,
    topic: row.topic,
    date: row.date,
    nextAction: row.nextAction,
    nextActionDueAt: row.nextActionDueAt,
    cooperationId: row.cooperationId,
    label,
  }
}

export async function loadPulseExtras(user: CurrentUser, now: Date): Promise<PulseExtras | null> {
  try {
    const scope = universityScope(user)
    const [stalled, meetings, completions, insights] = await Promise.all([
      stalledStates(scope, now, { responsibleId: user.id }),
      repo.findPulseMeetings(user.id, {
        pastFrom: new Date(now.getTime() - INSIGHTS.meetingLookbackDays * DAY_MS),
        pastTo: new Date(now.getTime() - INSIGHTS.meetingResultGraceDays * DAY_MS),
        dayFrom: moscowDayStart(now),
        dayTo: moscowDayStart(now, 1),
      }),
      repo.findRecentCompletions(user.id, new Date(now.getTime() - DAY_MS), now),
      sharedInsights(scope, now),
    ])
    return {
      stalled: stalled
        .filter((state) => state.stalledNow)
        .map((state) => {
          const threshold = getStalledThreshold(state.stageNumber)
          return {
            cooperationId: state.cooperationId,
            stageNumber: state.stageNumber,
            stageTitle: state.stageTitle,
            universityName: state.universityName,
            programName: state.programName,
            idleDays: state.idleDays,
            thresholdDays: threshold.days,
            thresholdSource: threshold.source,
          }
        }),
      meetingsWithoutResult: meetings.withoutResult.map(meetingSource),
      meetingsToday: meetings.today.map(meetingSource),
      actionsToday: meetings.actionsToday.map(meetingSource),
      completions: completions.map((row) => ({
        stageId: row.stage.id,
        stageNumber: row.stage.stageNumber,
        stageTitle: row.stage.title,
        cooperationId: row.stage.cooperation.id,
        universityName: row.stage.cooperation.university.shortName ?? row.stage.cooperation.university.name,
        programName: row.stage.cooperation.program.name,
        at: row.changedAt,
      })),
      insights: insights.insights,
      insightChecks: insights.checks,
    }
  } catch (error) {
    console.error('[PULSE] не удалось собрать расширения пульса', describeForLog(error))
    return null
  }
}
