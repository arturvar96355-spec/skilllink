import { SKILL_GAP } from '@/shared/config/analytics.config'
import type { SkillLevel } from '@/shared/contracts/enums'
import { normalize, outOf100, range, round } from '@/shared/utils/number'

/** Покрытие навыка программой по уровню освоения. Навыка нет — покрытие 0. */
export function coverageByLevel(level: SkillLevel | null): number {
  if (!level) return 0
  return SKILL_GAP.levelCoverage[level]
}

/**
 * Нормирует спрос к 0..1 по всей выборке периода.
 * Возвращает функцию, чтобы нормировать каждую строку одним и тем же масштабом.
 */
export function demandNormalizer(values: number[]): (value: number | null) => number | null {
  const bounds = range(values)
  if (!bounds) return () => null
  return (value) => (value === null ? null : round(normalize(value, bounds.min, bounds.max), 3))
}

export interface GapCalculation {
  coverage: number
  gap: number
  isCritical: boolean
  explanation: string
}

/**
 * Дефицит навыка: насколько спрос рынка превышает покрытие программой.
 * Если спроса нет, дефицит не считается — это не ноль, а отсутствие данных.
 */
export function calculateGap(
  demandNormalized: number | null,
  level: SkillLevel | null,
  skillName: string,
): GapCalculation {
  const coverage = coverageByLevel(level)

  if (demandNormalized === null) {
    return {
      coverage,
      gap: 0,
      isCritical: false,
      explanation: `Нет данных о востребованности навыка «${skillName}» за выбранный период`,
    }
  }

  const gap = round(Math.max(0, demandNormalized - coverage), 3)
  const isDemanded = demandNormalized >= SKILL_GAP.demandThreshold
  const isCritical = SKILL_GAP.criticalWhenMissing && isDemanded && coverage === 0

  const explanation = isCritical
    ? `Навык «${skillName}» востребован рынком (${outOf100(demandNormalized)} из 100), но в программе отсутствует`
    : `Спрос ${outOf100(demandNormalized)} из 100, покрытие программой ${outOf100(coverage)} из 100`

  return { coverage, gap, isCritical, explanation }
}

/**
 * Конец периода в миллисекундах: «2026-Q1» — 31 марта, «2026-09» — 30 сентября.
 * `null` — формат не распознан.
 */
export function periodEnd(period: string): number | null {
  const quarter = /^(\d{4})-Q([1-4])$/.exec(period)
  if (quarter) return Date.UTC(Number(quarter[1]), Number(quarter[2]) * 3, 0)
  const month = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(period)
  if (month) return Date.UTC(Number(month[1]), Number(month[2]), 0)
  return null
}

/**
 * Самый свежий период — по календарю, а не по алфавиту.
 *
 * Периоды бывают кварталами и месяцами (схема MarketDemand). Сортировка строк
 * ставила «2026-Q1» после «2026-09»: буква Q в таблице символов идёт после цифр.
 * Дефициты и рекомендации считались бы по данным полугодовой давности.
 */
export function latestOfPeriods(periods: readonly string[]): string | null {
  let best: string | null = null
  let bestEnd = -Infinity
  for (const period of periods) {
    const end = periodEnd(period) ?? -Infinity
    if (best === null || end > bestEnd || (end === bestEnd && period > best)) {
      best = period
      bestEnd = end
    }
  }
  return best
}

/** Федеральный замер спроса — значение региона по умолчанию (схема MarketDemand). */
export const FEDERAL_REGION = 'Россия'

/**
 * Один замер спроса на навык за период.
 *
 * Замеров на навык бывает несколько: по регионам и источникам (уникальный ключ —
 * навык, период, источник, регион). Дефицит считался по каждой строке: навык
 * дважды появлялся в списке дефицитов, покрытие на главной считало его дважды,
 * а рекомендации по двум строкам одного навыка перезаписывали друг друга.
 * Берётся федеральный замер, а без него — наибольший из региональных.
 */
export function demandPerSkill<T extends { skillId: string; value: number; region: string }>(
  rows: readonly T[],
): T[] {
  const bySkill = new Map<string, T>()
  for (const row of rows) {
    const current = bySkill.get(row.skillId)
    if (!current) {
      bySkill.set(row.skillId, row)
      continue
    }
    const currentFederal = current.region === FEDERAL_REGION
    const rowFederal = row.region === FEDERAL_REGION
    if ((rowFederal && !currentFederal) || (rowFederal === currentFederal && row.value > current.value)) {
      bySkill.set(row.skillId, row)
    }
  }
  return [...bySkill.values()]
}

