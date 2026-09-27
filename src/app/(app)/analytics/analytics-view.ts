import type { RankedProgramDto, SkillDemandDto, SkillGapDto } from '@/shared/contracts'
import type { MeasureBarRow } from '@/ui/data/MeasureBars'
import { formatNumber, formatScore, pluralize } from '@/ui/lib/format'

/**
 * Выводы одной фразой и полосы для вкладок аналитики (решение 215, правила единого
 * языка диаграмм): под названием блока — что видно из данных, у числа — с чем
 * сравнить, остаток списка — строкой.
 */

/** Сколько строк показывать полосами над таблицей; остальное — строкой «и ещё N». */
export const CHART_ROWS = 8

/** «A, B и C», больше трёх — «A, B, C и ещё 2». */
export function listNames(names: readonly string[], limit = 3): string {
  const quoted = names.map((name) => `«${name}»`)
  if (quoted.length <= 1) return quoted.join('')
  if (quoted.length <= limit) return `${quoted.slice(0, -1).join(', ')} и ${quoted[quoted.length - 1]}`
  return `${quoted.slice(0, limit).join(', ')} и ещё ${formatNumber(quoted.length - limit)}`
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2
}

/** Во сколько раз больше медианы — словами: «в 3,1 раза больше медианы», «на уровне медианы». */
export function againstMedian(value: number, base: number): string {
  if (base <= 0) return 'медианы нет'
  const ratio = value / base
  if (ratio >= 0.9 && ratio <= 1.1) return 'на уровне медианы'
  const rounded = Math.round(ratio * 10) / 10
  const text = rounded.toLocaleString('ru-RU', { maximumFractionDigits: 1 })
  return ratio > 1 ? `в ${text} раза выше медианы` : `${Math.round(ratio * 100)} % от медианы`
}

// ─────────────────────────────── Рейтинг ───────────────────────────────────

export function ratingConclusion(rows: readonly RankedProgramDto[], total: number): string {
  const ranked = rows.filter((row) => row.score !== null)
  const leader = ranked[0]
  if (!leader) return 'Ни у одной программы не заполнены показатели набора — сравнивать не с чем.'
  const second = ranked[1]
  const head = `Первая — «${leader.programName}», ${leader.universityName}: ${formatScore(leader.score)} из 100`
  const next = second ? `; у второй — ${formatScore(second.score)}` : ''
  return `${head}${next}. Всего в рейтинге ${formatNumber(total)} ${pluralize(total, ['программа', 'программы', 'программ'])}.`
}

// ──────────────────────────── Навыки и дефициты ─────────────────────────────

export function gapsConclusion(rows: readonly SkillGapDto[], total: number): string {
  const critical = rows.filter((row) => row.isCritical)
  const withGap = rows.filter((row) => row.gap > 0)
  const of = `${formatNumber(total)} ${pluralize(total, ['навыка', 'навыков', 'навыков'])}`
  if (critical.length > 0) {
    return `Критичных дефицитов — ${formatNumber(critical.length)} из ${of}: ${listNames(critical.map((row) => row.name))} — рынок их просит, а в программах их нет.`
  }
  const worst = withGap[0]
  if (worst) {
    return `Критичных дефицитов нет; больше всего не хватает «${worst.name}»: дефицит ${Math.round(worst.gap * 100)} из 100.`
  }
  return 'Дефицитов нет: программы покрывают всё, что просит рынок в этом периоде.'
}

/** Полосы «где дефицит»: навыки с дефицитом, крупнейшие сверху; критичный — красным, остальные — жёлтым. */
export function gapRows(rows: readonly SkillGapDto[]): { rows: MeasureBarRow[]; rest: string | undefined } {
  const withGap = [...rows].filter((row) => row.gap > 0).sort((a, b) => b.gap - a.gap)
  const shown = withGap.slice(0, CHART_ROWS)
  const hidden = withGap.length - shown.length
  const covered = rows.length - withGap.length
  const restParts: string[] = []
  if (hidden > 0) restParts.push(`и ещё ${formatNumber(hidden)} ${pluralize(hidden, ['навык', 'навыка', 'навыков'])} с дефицитом`)
  if (covered > 0) restParts.push(`${formatNumber(covered)} ${pluralize(covered, ['навык покрыт', 'навыка покрыты', 'навыков покрыты'])} полностью`)
  return {
    rows: shown.map((row) => {
      const demand = row.demandNormalized === null ? null : Math.round(row.demandNormalized * 100)
      return {
        key: row.skillId,
        label: row.name,
        caption: row.category,
        value: Math.round(row.gap * 100),
        valueText: `${Math.round(row.gap * 100)} из 100`,
        tone: row.isCritical ? 'danger' : 'warning',
        note: `${demand === null ? 'спрос — нет данных' : `спрос ${demand}`} · покрыто ${Math.round(row.coverage * 100)}${row.isCritical ? ' · критичный' : ''}`,
        noteTone: row.isCritical ? 'danger' : 'default',
      }
    }),
    rest: restParts.length > 0 ? `${restParts.join('; ')} — в таблице ниже.` : undefined,
  }
}

// ─────────────────────────────── Спрос рынка ────────────────────────────────

export function demandConclusion(rows: readonly SkillDemandDto[]): string {
  const measured = rows.filter((row): row is SkillDemandDto & { value: number } => row.value !== null)
  const top = [...measured].sort((a, b) => b.value - a.value)[0]
  const base = median(measured.map((row) => row.value))
  if (!top || base === null) return 'Замеров спроса нет — сравнивать не с чем.'
  return `Больше всего спрашивают «${top.name}»: ${formatNumber(top.value)} ${top.unit} — ${againstMedian(top.value, base)} по ${formatNumber(measured.length)} ${pluralize(measured.length, ['навыку', 'навыкам', 'навыкам'])} (${formatNumber(Math.round(base))}).`
}

/** Полосы спроса: самые востребованные сверху, отметка — медиана выборки. */
export function demandRows(rows: readonly SkillDemandDto[]): {
  rows: MeasureBarRow[]
  max: number
  rest: string | undefined
} {
  const measured = rows.filter((row): row is SkillDemandDto & { value: number } => row.value !== null)
  const sorted = [...measured].sort((a, b) => b.value - a.value)
  const shown = sorted.slice(0, CHART_ROWS)
  const base = median(measured.map((row) => row.value))
  const hidden = rows.length - shown.length
  return {
    max: shown[0]?.value ?? 0,
    rows: shown.map((row) => ({
      key: row.skillId,
      label: row.name,
      caption: row.category,
      value: row.value,
      valueText: `${formatNumber(row.value)} ${row.unit}`,
      marker: base,
      note: base === null ? undefined : againstMedian(row.value, base),
    })),
    rest:
      hidden > 0
        ? `и ещё ${formatNumber(hidden)} ${pluralize(hidden, ['навык', 'навыка', 'навыков'])} — в таблице ниже.`
        : undefined,
  }
}
