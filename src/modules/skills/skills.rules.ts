import { SKILL_GAP } from '@/shared/config/analytics.config'
import type { SkillLevel } from '@/shared/contracts/enums'
import { normalize, range, round } from '@/shared/utils/number'

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
    ? `Навык «${skillName}» востребован рынком (${round(demandNormalized * 100)} из 100), но в программе отсутствует`
    : `Спрос ${round(demandNormalized * 100)} из 100, покрытие программой ${round(coverage * 100)} из 100`

  return { coverage, gap, isCritical, explanation }
}
