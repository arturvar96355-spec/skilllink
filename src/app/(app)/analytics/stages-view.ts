import type { StageDurationDto } from '@/shared/contracts'
import type { MeasureBarRow } from '@/ui/data/MeasureBars'
import { formatNumber, pluralize } from '@/ui/lib/format'

/**
 * Вкладка «Этапы» (решение 215): вывод одной фразой и длительность этапов
 * полосами — медиана против порога застоя.
 */

export interface StageLoad {
  stageNumber: number
  title: string
  inProgress: number | null
  overdue: number
  blocked: number
}

export function days(value: number): string {
  return `${formatNumber(value)} ${pluralize(value, ['день', 'дня', 'дней'])}`
}

/** Где копятся связки: больше всего просрочек и блокировок, при равенстве — больше связок на этапе. */
export function stagesConclusion(rows: readonly StageLoad[]): string {
  const inWork = rows.reduce((sum, row) => sum + (row.inProgress ?? 0), 0)
  const byProblems = [...rows].sort(
    (a, b) => b.overdue + b.blocked - (a.overdue + a.blocked) || (b.inProgress ?? 0) - (a.inProgress ?? 0),
  )
  const worst = byProblems[0]
  if (!worst) return 'Связок на этапах нет.'
  const here = `сейчас на нём ${formatNumber(worst.inProgress ?? 0)} из ${formatNumber(inWork)}`
  if (worst.overdue + worst.blocked === 0) {
    const busiest = [...rows].sort((a, b) => (b.inProgress ?? 0) - (a.inProgress ?? 0))[0]!
    return `Просрочек и блокировок нет; больше всего связок на этапе ${busiest.stageNumber} «${busiest.title}»: ${formatNumber(busiest.inProgress ?? 0)} из ${formatNumber(inWork)}.`
  }
  return `Связки копятся на этапе ${worst.stageNumber} «${worst.title}»: ${here}, просрочено ${formatNumber(worst.overdue)}, заблокировано ${formatNumber(worst.blocked)}.`
}

/** Насколько медиана дольше порога застоя; null — медианы нет или она в пределах порога. */
function overThreshold(stage: StageDurationDto): number | null {
  if (stage.median === null) return null
  const over = Math.round(stage.median - stage.threshold.days)
  return over > 0 ? over : null
}

export function durationsConclusion(stages: readonly StageDurationDto[]): string {
  const over = stages
    .map((stage) => ({ stage, over: overThreshold(stage) }))
    .filter((item): item is { stage: StageDurationDto; over: number } => item.over !== null)
    .sort((a, b) => b.over - a.over)
  const first = over[0]
  if (!first) return 'Все этапы обычно укладываются в порог застоя.'
  const count = `${formatNumber(over.length)} из ${formatNumber(stages.length)}`
  return `Дольше порога застоя обычно идут ${count} этапов; сильнее всего — ${first.stage.stageNumber} «${first.stage.title}»: ${days(Math.round(first.stage.median!))} при пороге ${days(first.stage.threshold.days)}.`
}

/**
 * Полосы длительности: медиана этапа, отметка — порог застоя. Дольше порога — жёлтым
 * («ниже цели»); оценка по малому числу связок — приглушённо и словами.
 */
export function durationRows(stages: readonly StageDurationDto[]): { rows: MeasureBarRow[]; max: number } {
  const max = Math.max(1, ...stages.map((stage) => Math.max(stage.median ?? 0, stage.threshold.days)))
  return {
    max,
    rows: stages.map((stage) => {
      const over = overThreshold(stage)
      const few = stage.status === 'insufficient_data'
      const source = stage.threshold.source === 'km' ? 'порог по истории этапов' : 'порог — норматив'
      return {
        key: String(stage.stageNumber),
        label: stage.title,
        caption: `этап ${stage.stageNumber} · ${source}${few ? ' · данных мало' : ''}`,
        value: stage.median,
        valueText: stage.median === null ? 'нет данных' : days(Math.round(stage.median)),
        marker: stage.threshold.days,
        tone: over !== null ? 'warning' : few ? 'muted' : 'default',
        note:
          stage.median === null
            ? `порог ${days(stage.threshold.days)}`
            : over !== null
              ? `на ${days(over)} дольше порога (${stage.threshold.days} дн.)`
              : `в пределах порога (${stage.threshold.days} дн.)`,
        noteTone: over !== null ? 'warning' : 'default',
      }
    }),
  }
}
