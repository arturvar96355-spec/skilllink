import {
  PROGRAM_RATING_LABELS,
  PROGRAM_RATING_WEIGHTS,
  RATING_MIN_FILLED_FACTORS,
  RATING_SCALE,
  UNIVERSITY_RATING,
  UNIVERSITY_RATING_METHOD_LABELS,
  type ProgramRatingFactor,
} from '@/shared/config/analytics.config'
import type { DataOrigin } from '@/shared/contracts/enums'
import type {
  ProgramRatingDto,
  RatingFactorDto,
  UniversityRatingDto,
} from '@/shared/contracts/rating'
import { normalize, range, round } from '@/shared/utils/number'
import { PROGRAM_FORMS_OF, plural, pluralize } from '@/shared/utils/text'

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

export interface UniversityRatingInput {
  programId: string
  programName: string
  universityId: string
}

/**
 * Рейтинг вуза (пункт 7.2 ТЗ) — агрегат рейтингов его программ.
 *
 * Считается поверх уже посчитанных рейтингов программ, чтобы шкала была одна:
 * показатели нормируются внутри всей выборки программ, а не внутри вуза.
 * Иначе вуз с одной программой всегда получал бы 100 баллов.
 *
 * Программы без рассчитанного балла в среднее не входят и не тянут его вниз:
 * «Нет данных» — это не ноль (решение 8).
 */
export function aggregateUniversityRatings(
  programs: readonly UniversityRatingInput[],
  ratings: ReadonlyMap<string, ProgramRatingDto>,
): Map<string, UniversityRatingDto> {
  const byUniversity = new Map<string, UniversityRatingInput[]>()
  for (const program of programs) {
    const list = byUniversity.get(program.universityId)
    if (list) list.push(program)
    else byUniversity.set(program.universityId, [program])
  }

  const result = new Map<string, UniversityRatingDto>()

  for (const [universityId, universityPrograms] of byUniversity) {
    const scored: { program: UniversityRatingInput; rating: ProgramRatingDto }[] = []

    for (const program of universityPrograms) {
      const rating = ratings.get(program.programId)
      if (rating && rating.score !== null) scored.push({ program, rating })
    }

    const programCount = universityPrograms.length
    const ratedProgramCount = scored.length

    if (ratedProgramCount < UNIVERSITY_RATING.minRatedPrograms) {
      result.set(universityId, {
        universityId,
        score: null,
        basis: 'none',
        explanation:
          programCount === 0
            ? 'Нет данных: у вуза нет действующих программ'
            : programCount === 1
              ? 'Нет данных: у единственной программы вуза не заполнены показатели рейтинга'
              : `Нет данных: показатели рейтинга не заполнены ни у одной из ${pluralize(programCount, PROGRAM_FORMS_OF)} вуза`,
        programCount,
        ratedProgramCount,
        topProgram: null,
      })
      continue
    }

    const best = scored.reduce((left, right) =>
      (right.rating.score ?? 0) > (left.rating.score ?? 0) ? right : left,
    )

    const score =
      UNIVERSITY_RATING.method === 'best'
        ? (best.rating.score ?? 0)
        : scored.reduce((sum, item) => sum + (item.rating.score ?? 0), 0) / ratedProgramCount

    // Балл считается оценочным, если хоть одна программа опирается на экспертные
    // или демонстрационные данные: понижать достоверность безопаснее, чем завышать.
    const basis = scored.some((item) => item.rating.basis === 'estimate') ? 'estimate' : 'actual'

    result.set(universityId, {
      universityId,
      score: round(score, 1),
      basis,
      explanation:
        `Балл вуза — ${UNIVERSITY_RATING_METHOD_LABELS[UNIVERSITY_RATING.method]}; ` +
        `учтено ${ratedProgramCount} из ${programCount} ${plural(programCount, PROGRAM_FORMS_OF)}, ` +
        'показатели нормированы внутри всей выборки программ',
      programCount,
      ratedProgramCount,
      topProgram: {
        programId: best.program.programId,
        name: best.program.programName,
        score: best.rating.score ?? 0,
      },
    })
  }

  return result
}
