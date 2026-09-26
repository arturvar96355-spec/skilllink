/**
 * Калькулятор «хватает ли демо-данных аналитике этапов» (решение 131).
 *
 * Формулы — те, что закладывает аналитика этапов (решение 120), но своей копией:
 * демо-набор не должен зависеть от её кода. Если формулы там поменяются — поменять
 * пороги здесь и перепроверить тестом, что набор по-прежнему их проходит.
 *
 * - Каплан — Мейер по длительности этапа: оценка строится, если наблюдений не меньше
 *   30 и событий (этап завершён) не меньше 15. Незавершённый этап — цензурирован
 *   сегодняшним днём, этап отменённой связки — моментом отмены.
 * - Аномалия дневного ряда: z = (mean7 − mean28) / max(sd28, 0.01·mean28, 1), где
 *   mean7 — последние 7 полных московских суток, mean28 и sd28 — 28 полных суток
 *   перед ними (окна не пересекаются, sd выборочное, n − 1); аномалия, если |z| > 2
 *   и |mean7 / mean28 − 1| ≥ 15 %. Нужно ≥ 35 полных дней.
 * - Ряды — те же, что смотрит «Система заметила»: встречи (по дате, прошедшие),
 *   переходы этапов (записи истории «→ завершён» по этапам 1–13), новые связки
 *   (кроме черновиков, по дате начала).
 */

import type { DemoCooperation, DemoData } from './generate'
import { DAY_MS } from './generate'

export const KM_MIN_OBSERVATIONS = 30
export const KM_MIN_EVENTS = 15
export const ANOMALY_Z = 2
export const ANOMALY_MIN_CHANGE = 0.15
export const ANOMALY_MIN_DAYS = 35

export interface Observation {
  /** Длительность, дней. */
  duration: number
  /** true — этап завершён (событие), false — цензурирован. */
  event: boolean
}

/** Наблюдения по этапам 1–13: кто входил в этап и сколько в нём пробыл. */
export function stageObservations(
  cooperations: ReadonlyArray<Pick<DemoCooperation, 'stages'>>,
  anchor: Date,
): Map<number, Observation[]> {
  const result = new Map<number, Observation[]>()
  for (const coop of cooperations) {
    for (const stage of coop.stages) {
      if (stage.number === 14 || !stage.startedAt) continue
      const end = stage.completedAt ?? stage.endedAt ?? anchor
      const list = result.get(stage.number) ?? []
      list.push({
        duration: (end.getTime() - stage.startedAt.getTime()) / DAY_MS,
        event: stage.status === 'COMPLETED',
      })
      result.set(stage.number, list)
    }
  }
  return result
}

export interface KmSufficiency {
  stage: number
  observations: number
  events: number
  enough: boolean
}

export function kmSufficiency(observations: Map<number, Observation[]>): KmSufficiency[] {
  const rows: KmSufficiency[] = []
  for (let stage = 1; stage <= 13; stage += 1) {
    const list = observations.get(stage) ?? []
    const events = list.filter((item) => item.event).length
    rows.push({
      stage,
      observations: list.length,
      events,
      enough: list.length >= KM_MIN_OBSERVATIONS && events >= KM_MIN_EVENTS,
    })
  }
  return rows
}

/** Кривая выживания Каплана — Мейера и медиана (null — кривая не опустилась до 0,5). */
export function kaplanMeier(observations: readonly Observation[]): {
  curve: Array<{ time: number; survival: number }>
  median: number | null
} {
  const sorted = [...observations].sort((a, b) => a.duration - b.duration || Number(b.event) - Number(a.event))
  let atRisk = sorted.length
  let survival = 1
  let median: number | null = null
  const curve: Array<{ time: number; survival: number }> = []
  let index = 0
  while (index < sorted.length) {
    const time = sorted[index]!.duration
    let events = 0
    let removed = 0
    while (index < sorted.length && sorted[index]!.duration === time) {
      if (sorted[index]!.event) events += 1
      removed += 1
      index += 1
    }
    if (events > 0 && atRisk > 0) {
      survival *= 1 - events / atRisk
      curve.push({ time, survival })
      if (median === null && survival <= 0.5) median = time
    }
    atRisk -= removed
  }
  return { curve, median }
}

/**
 * Дневной ряд: сколько событий пришлось на каждый полный день до якорной даты,
 * по московскому времени (UTC+3). Сегодняшний неполный день не входит.
 */
export function dailyCounts(dates: readonly Date[], anchor: Date, days: number): number[] {
  const MOSCOW_OFFSET = 3 * 60 * 60 * 1000
  const dayOf = (date: Date) => Math.floor((date.getTime() + MOSCOW_OFFSET) / DAY_MS)
  const today = dayOf(anchor)
  const counts = new Array<number>(days).fill(0)
  for (const date of dates) {
    const back = today - dayOf(date)
    if (back >= 1 && back <= days) counts[days - back]! += 1
  }
  return counts
}

export interface AnomalyResult {
  mean7: number
  mean28: number
  sd28: number
  z: number
  change: number
  isAnomaly: boolean
}

/** Детектор аномалии на последней неделе ряда. null — истории меньше 35 полных дней. */
export function detectAnomaly(series: readonly number[]): AnomalyResult | null {
  if (series.length < ANOMALY_MIN_DAYS) return null
  const last7 = series.slice(-7)
  const base = series.slice(-35, -7)
  const mean = (values: readonly number[]) => values.reduce((sum, value) => sum + value, 0) / values.length
  const mean7 = mean(last7)
  const mean28 = mean(base)
  // Выборочное стандартное отклонение (n − 1) — как у детектора аналитики этапов.
  const sd28 = Math.sqrt(base.reduce((sum, value) => sum + (value - mean28) ** 2, 0) / (base.length - 1))
  const z = (mean7 - mean28) / Math.max(sd28, 0.01 * mean28, 1)
  const change = mean28 === 0 ? (mean7 === 0 ? 0 : Infinity) : mean7 / mean28 - 1
  return {
    mean7,
    mean28,
    sd28,
    z,
    change,
    isAnomaly: Math.abs(z) > ANOMALY_Z && Math.abs(change) >= ANOMALY_MIN_CHANGE,
  }
}

/**
 * События связок, из которых складывается «спрос» на продукт: новые связки,
 * смены статусов их этапов и прошедшие встречи. Такой же ряд даёт и общая
 * активность — если не фильтровать по продукту.
 */
export function activityDates(
  cooperations: ReadonlyArray<Pick<DemoCooperation, 'startedAt' | 'stages' | 'meetings' | 'productKey'>>,
  anchor: Date,
  productKey?: string,
): Date[] {
  const dates: Date[] = []
  for (const coop of cooperations) {
    if (productKey !== undefined && coop.productKey !== productKey) continue
    dates.push(coop.startedAt)
    for (const stage of coop.stages) for (const entry of stage.history) dates.push(entry.changedAt)
    for (const meeting of coop.meetings) if (meeting.date <= anchor) dates.push(meeting.date)
  }
  return dates
}

/** Ряд «Встречи»: прошедшие встречи связок и встречи с вузами без связки. */
export function meetingDates(data: Pick<DemoData, 'cooperations' | 'universityMeetings'>, anchor: Date): Date[] {
  return [
    ...data.cooperations.flatMap((coop) => coop.meetings.map((meeting) => meeting.date)),
    ...data.universityMeetings.map((meeting) => meeting.date),
  ].filter((date) => date <= anchor)
}

/** Ряд «Переходы этапов»: записи истории «→ завершён» по этапам 1–13. */
export function transitionDates(cooperations: ReadonlyArray<Pick<DemoCooperation, 'stages'>>): Date[] {
  return cooperations.flatMap((coop) =>
    coop.stages
      .filter((stage) => stage.number !== 14)
      .flatMap((stage) => stage.history.filter((entry) => entry.toStatus === 'COMPLETED').map((entry) => entry.changedAt)),
  )
}

/** Ряд «Новые связки»: кроме черновиков, по дате начала. */
export function newCooperationDates(cooperations: ReadonlyArray<Pick<DemoCooperation, 'status' | 'startedAt'>>): Date[] {
  return cooperations.filter((coop) => coop.status !== 'DRAFT').map((coop) => coop.startedAt)
}
