/**
 * Медиана длительности этапа — для признака «дней на этапе к медиане» (решение 125).
 *
 * Одна точка входа `stageMedians`: сюда подключается более точный расчёт
 * (аналитика этапов с учётом незавершённых — Каплан — Мейер), когда он появится.
 * Пока — запасной расчёт: медиана по завершениям этапа в истории до даты `until`,
 * а если завершений мало — нормативная длительность этапа из конфига.
 */

import { FORECAST } from '@/shared/config/forecast.config'
import { STAGE_BY_NUMBER } from '@/shared/config/workflow.config'
import { median } from './forecast-math'
import {
  becameCurrentAt,
  truncateTimeline,
  type CooperationTimeline,
} from './forecast-features'

const DAY_MS = 24 * 60 * 60 * 1000

export interface StageMedian {
  days: number
  basis: 'observed' | 'normative'
  observations: number
}

export interface StageMedians {
  medianDays(stageNumber: number): number
  /** Для сохранения вместе с моделью: прогноз обязан нормировать так же, как обучение. */
  toJSON(): Record<string, StageMedian>
}

/** Нормативная длительность этапа: разница нормативных сроков соседних этапов, не меньше суток. */
export function normativeStageDays(stageNumber: number): number {
  const current = STAGE_BY_NUMBER.get(stageNumber)?.normativeDays ?? 30
  const previous = stageNumber > 1 ? (STAGE_BY_NUMBER.get(stageNumber - 1)?.normativeDays ?? 0) : 0
  return Math.max(current - previous, 1)
}

/**
 * Внешний источник медиан (например, аналитика этапов). Возвращает null,
 * если по этапу у него данных нет, — тогда работает запасной расчёт.
 */
export type ExternalStageMedian = (stageNumber: number, until: Date) => number | null

/**
 * Длительности завершённых этапов: от момента, когда этап стал текущим,
 * до его завершения. Только завершения не позже `until` — без взгляда в будущее.
 */
export function observedStageDurations(
  timelines: readonly CooperationTimeline[],
  until: Date,
): Map<number, number[]> {
  const durations = new Map<number, number[]>()
  for (const full of timelines) {
    const timeline = truncateTimeline(full, until)
    const completions = timeline.stageEvents.filter((event) => event.toStatus === 'COMPLETED')
    for (const event of completions) {
      const upToCompletion = truncateTimeline(timeline, event.at)
      const start = becameCurrentAt(upToCompletion, event.stageNumber)
      const value = (event.at.getTime() - start.getTime()) / DAY_MS
      if (value < 0) continue
      const list = durations.get(event.stageNumber) ?? []
      list.push(value)
      durations.set(event.stageNumber, list)
    }
  }
  return durations
}

export function stageMedians(
  timelines: readonly CooperationTimeline[],
  until: Date,
  external?: ExternalStageMedian,
): StageMedians {
  const observed = observedStageDurations(timelines, until)
  const table = new Map<number, StageMedian>()
  const resolve = (stageNumber: number): StageMedian => {
    const cached = table.get(stageNumber)
    if (cached) return cached
    const fromExternal = external?.(stageNumber, until) ?? null
    const values = observed.get(stageNumber) ?? []
    const result: StageMedian =
      fromExternal !== null
        ? { days: fromExternal, basis: 'observed', observations: values.length }
        : values.length >= FORECAST.medianMinObservations
          ? { days: Math.max(median(values) ?? 1, 1), basis: 'observed', observations: values.length }
          : { days: normativeStageDays(stageNumber), basis: 'normative', observations: values.length }
    table.set(stageNumber, result)
    return result
  }
  return {
    medianDays: (stageNumber) => resolve(stageNumber).days,
    toJSON: () => {
      for (let stage = 1; stage <= 13; stage += 1) resolve(stage)
      return Object.fromEntries([...table.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => [String(k), v]))
    },
  }
}

/** Медианы, сохранённые с моделью: прогноз нормирует ровно так же, как обучение. */
export function storedStageMedians(stored: Record<string, StageMedian>): StageMedians {
  return {
    medianDays: (stageNumber) => stored[String(stageNumber)]?.days ?? normativeStageDays(stageNumber),
    toJSON: () => stored,
  }
}
