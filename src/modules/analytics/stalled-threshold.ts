import { RECOMMENDATION_RULES, STALLED_THRESHOLD } from '@/shared/config/analytics.config'
import type { DurationSummary } from './survival'

/**
 * Порог застоя этапа — одна точка подмены (решение 120).
 *
 * Правило рекомендаций «связка без движения» спрашивает порог здесь, а не читает
 * `RECOMMENDATION_RULES.stalledDays` напрямую. Если по этапу хватает истории и флаг
 * `STALLED_THRESHOLD.fromData` включён — порог = p90 длительности этапа по
 * Каплану–Мейеру («дольше, чем проходят этап 90% связок»), иначе — ручной параметр.
 *
 * Модуль чистый и синхронный: правила рекомендаций остаются чистыми функциями.
 * Посчитанные по базе сводки кладёт сюда `stage-analytics.service.ts`
 * (`ensureStageDurations`) — перед пересборкой рекомендаций, пульсом и
 * предпросмотром. Пока сводок нет (холодный старт, тесты), ответ — ручной порог.
 */

export interface StalledThreshold {
  days: number
  source: 'km' | 'manual'
  /** Интервал дня p90 (нижняя и верхняя граница); null у ручного порога. */
  ci: { low: number | null; high: number | null } | null
  /** Наблюдений по этапу (0 — оценки не было). */
  n: number
  /** Завершённых переходов из этапа. */
  events: number
  /** Почему ручной: выключено, данных мало, p90 не достигнут. null у порога по данным. */
  reason: 'disabled' | 'insufficient_data' | 'quantile_not_reached' | 'not_computed' | null
}

let summaries: ReadonlyMap<number, DurationSummary> | null = null
let computedAt = 0

/** Положить посчитанные сводки (по номеру этапа). */
export function setStageDurations(next: ReadonlyMap<number, DurationSummary>, at: number = Date.now()): void {
  summaries = next
  computedAt = at
}

/** Сводки устарели или их нет — пора пересчитать. */
export function stageDurationsStale(now: number = Date.now()): boolean {
  return summaries === null || now - computedAt > STALLED_THRESHOLD.cacheMinutes * 60_000
}

export function cachedStageDurations(): ReadonlyMap<number, DurationSummary> | null {
  return summaries
}

/** Сбросить память — для тестов и после перезаливки данных. */
export function resetStageDurations(): void {
  summaries = null
  computedAt = 0
}

/** Порог по сводке этапа — чистая функция: её проверяют тесты и предпросмотр. */
export function thresholdFrom(
  summary: DurationSummary | undefined,
  options: { fromData: boolean; manualDays: number } = {
    fromData: STALLED_THRESHOLD.fromData,
    manualDays: RECOMMENDATION_RULES.stalledDays,
  },
): StalledThreshold {
  const manual = (reason: StalledThreshold['reason']): StalledThreshold => ({
    days: options.manualDays,
    source: 'manual',
    ci: null,
    n: summary?.n ?? 0,
    events: summary?.events ?? 0,
    reason,
  })
  if (!options.fromData) return manual('disabled')
  if (!summary) return manual('not_computed')
  if (summary.status !== 'ok') return manual('insufficient_data')
  if (summary.p90.day === null) return manual('quantile_not_reached')
  return {
    // Ноль дней — «застряла сразу»: так не бывает, минимум сутки.
    days: Math.max(1, summary.p90.day),
    source: 'km',
    ci: summary.p90.ci,
    n: summary.n,
    events: summary.events,
    reason: null,
  }
}

/** Порог застоя для этапа `stage` — то, что читает правило рекомендаций. */
export function getStalledThreshold(stage: number): StalledThreshold {
  return thresholdFrom(summaries?.get(stage))
}

/**
 * Откуда порог — одной фразой для обоснования рекомендации. Ручной порог пишется
 * как раньше («Порог — 14 дн.»): текст рекомендаций до решения 120 не меняется.
 */
export function stalledThresholdText(threshold: StalledThreshold): string {
  if (threshold.source === 'manual') return `Порог — ${threshold.days} дн.`
  return (
    `Порог — ${threshold.days} дн.: за столько этап проходят ${Math.round(STALLED_THRESHOLD.quantile * 100)}% связок ` +
    `(по истории ${threshold.n} связок, ${threshold.events} переходов).`
  )
}
