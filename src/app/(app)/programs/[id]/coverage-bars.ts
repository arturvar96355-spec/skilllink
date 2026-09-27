import type { SkillGapDto } from '@/shared/contracts'
import type { MeasureBarRow } from '@/ui/data/MeasureBars'
import { formatNumber, pluralize } from '@/ui/lib/format'

/**
 * «Спрос против покрытия» программы (решение 215): был радар, стал горизонтальные
 * полосы — полоса = покрытие программой, отметка = спрос рынка на ту же шкалу 0–100.
 * Где отметка правее конца полосы — там дефицит, и он назван словами.
 *
 * Выбор навыков — прежний, как у радара: до четырёх уже покрытых и самые
 * востребованные из непокрытых, всего до восьми. Дефициты вне профиля (решение 98)
 * не выносятся: они подчёркивали бы, что магистратуре ИИ «не хватает» Java.
 */
export const COVERAGE_ROWS = 8

export function coverageSelection(rows: readonly SkillGapDto[]): SkillGapDto[] {
  const byDemand = [...rows].sort((a, b) => (b.demandNormalized ?? 0) - (a.demandNormalized ?? 0))
  const covered = byDemand.filter((row) => row.coverage > 0).slice(0, 4)
  const rest = byDemand.filter((row) => !covered.includes(row) && !row.outOfProfile).slice(0, COVERAGE_ROWS - covered.length)
  return [...covered, ...rest].sort((a, b) => (b.demandNormalized ?? 0) - (a.demandNormalized ?? 0))
}

const score = (share: number | null): number | null => (share === null ? null : Math.round(share * 100))

export function coverageRows(rows: readonly SkillGapDto[]): MeasureBarRow[] {
  return coverageSelection(rows).map((row) => {
    const demand = score(row.demandNormalized)
    const coverage = Math.round(row.coverage * 100)
    const lack = demand === null ? 0 : Math.max(0, demand - coverage)
    return {
      key: row.skillId,
      label: row.name,
      caption: row.category,
      value: coverage,
      valueText: `${coverage} из 100`,
      marker: demand,
      tone: row.isCritical ? 'danger' : lack > 0 ? 'warning' : 'default',
      note:
        demand === null
          ? 'спрос — нет данных'
          : row.isCritical
            ? `спрос ${demand} — в программе нет`
            : lack > 0
              ? `спрос ${demand} — не хватает ${lack}`
              : `спрос ${demand} — покрыт`,
      noteTone: row.isCritical ? 'danger' : lack > 0 ? 'warning' : 'default',
    }
  })
}

export function coverageConclusion(rows: readonly SkillGapDto[]): string {
  const shown = coverageSelection(rows)
  const short = shown.filter((row) => row.demandNormalized !== null && row.demandNormalized > row.coverage + 0.005)
  if (short.length === 0) return 'Программа покрывает спрос рынка по всем показанным навыкам.'
  const names = short.slice(0, 3).map((row) => `«${row.name}»`)
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} и ${names[names.length - 1]}` : names[0]
  const more = short.length > 3 ? ` и ещё ${formatNumber(short.length - 3)}` : ''
  return `Рынок просит больше, чем даёт программа, по ${formatNumber(short.length)} из ${formatNumber(shown.length)} ${pluralize(shown.length, ['навыка', 'навыков', 'навыков'])}: ${list}${more}.`
}
