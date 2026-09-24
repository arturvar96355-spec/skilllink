import { TREND_PERIOD_DAYS } from '@/shared/config/analytics.config'
import type { MetricTrendDto } from '@/shared/contracts/analytics'
import { percent, round } from '@/shared/utils/number'

/** Этап, по которому считается доля «в срок»: завершён и имел срок. */
export interface OnTimeCandidate {
  deadline: Date | null
  completedAt: Date | null
}

/** Закрыт не позже срока. */
export function isClosedOnTime(stage: OnTimeCandidate): boolean {
  return Boolean(stage.completedAt && stage.deadline && stage.completedAt <= stage.deadline)
}

/** Доля этапов, закрытых в срок, в процентах. `null` — считать не по чему. */
export function onTimePercent(stages: readonly OnTimeCandidate[]): number | null {
  return percent(stages.filter(isClosedOnTime).length, stages.length)
}

/** Изменение показателя к его значению на начало периода. */
export function compareWithPast(current: number, previous: number): MetricTrendDto {
  const delta = round(current - previous, 1)
  return {
    previous,
    delta,
    direction: delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat',
    periodLabel: `за ${TREND_PERIOD_DAYS} дней`,
  }
}
