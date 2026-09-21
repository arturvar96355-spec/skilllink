import {
  PROGRAM_RATING_LABELS,
  PROGRAM_RATING_WEIGHTS,
  RATING_MIN_FILLED_FACTORS,
  RATING_SCALE,
  type ProgramRatingFactor,
} from '@/shared/config/analytics.config'
import type { DataOrigin } from '@/shared/contracts/enums'
import type { ProgramRatingDto, RatingFactorDto } from '@/shared/contracts/rating'
import { normalize, range, round } from '@/shared/utils/number'

export interface RatingInput {
  programId: string
  applicationCount: number | null
  studentCount: number | null
  groupCount: number | null
  metricsSource: DataOrigin | null
}

const FACTORS: ProgramRatingFactor[] = ['applicationCount', 'studentCount', 'groupCount']

/** Оценочными считаются экспертные и демонстрационные данные. */
function basisFromSource(source: DataOrigin | null, filled: number): ProgramRatingDto['basis'] {
  if (filled === 0) return 'none'
  if (source === 'EXPERT' || source === 'MOCK') return 'estimate'
  return 'actual'
}

/**
 * Рейтинг образовательных программ по трём показателям ТЗ (решение 7).
 * Показатели нормируются внутри переданной выборки, поэтому рейтинг всегда относительный —
 * сравнивать баллы можно только внутри одного запроса. Это отражено в объяснении.
 *
 * Востребованность навыков, skill gap и готовность вуза в рейтинг НЕ входят.
 */
export function calculateRatings(programs: readonly RatingInput[]): Map<string, ProgramRatingDto> {
  const bounds = new Map<ProgramRatingFactor, { min: number; max: number } | null>()
  for (const factor of FACTORS) {
    bounds.set(factor, range(programs.map((program) => program[factor])))
  }

  const result = new Map<string, ProgramRatingDto>()

  for (const program of programs) {
    const factors: RatingFactorDto[] = []
    let weightedSum = 0
    let usedWeight = 0
    let filled = 0

    for (const factor of FACTORS) {
      const value = program[factor]
      const weight = PROGRAM_RATING_WEIGHTS[factor]
      const factorBounds = bounds.get(factor) ?? null

      if (value === null || factorBounds === null) {
        factors.push({
          key: factor,
          title: PROGRAM_RATING_LABELS[factor],
          value: null,
          normalized: null,
          weight,
          contribution: null,
        })
        continue
      }

      filled += 1
      const normalized = round(normalize(value, factorBounds.min, factorBounds.max), 3)
      const contribution = round(normalized * weight * RATING_SCALE, 2)
      weightedSum += normalized * weight
      usedWeight += weight

      factors.push({
        key: factor,
        title: PROGRAM_RATING_LABELS[factor],
        value,
        normalized,
        weight,
        contribution,
      })
    }

    const hasEnoughData = filled >= RATING_MIN_FILLED_FACTORS && usedWeight > 0
    const score = hasEnoughData ? round((weightedSum / usedWeight) * RATING_SCALE, 1) : null
    const basis = basisFromSource(program.metricsSource, filled)

    result.set(program.programId, {
      programId: program.programId,
      score,
      basis,
      explanation: hasEnoughData
        ? `Балл рассчитан по ${filled} из 3 показателей набора и нормирован внутри текущей выборки программ`
        : 'Нет данных: ни один из трёх показателей набора не заполнен',
      factors,
    })
  }

  return result
}
