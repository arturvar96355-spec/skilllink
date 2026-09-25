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
import { PROGRAM_FORMS_OF, plural, countWithNoun } from '@/shared/utils/text'

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

/** Границы нормирования по каждому показателю; null — заполненных значений нет. */
export type RatingBounds = ReadonlyMap<ProgramRatingFactor, { min: number; max: number } | null>

/** Границы нормирования по переданной выборке. */
export function boundsFromPrograms(programs: readonly RatingInput[]): RatingBounds {
  const bounds = new Map<ProgramRatingFactor, { min: number; max: number } | null>()
  for (const factor of FACTORS) {
    bounds.set(factor, range(programs.map((program) => program[factor])))
  }
  return bounds
}

/**
 * Рейтинг образовательных программ по трём показателям ТЗ: заявки, обучающиеся, группы.
 * Показатели нормируются внутри выборки, поэтому рейтинг всегда относительный —
 * сравнивать баллы можно только внутри одного запроса. Это отражено в объяснении.
 *
 * Востребованность навыков, skill gap и готовность вуза в рейтинг НЕ входят.
 *
 * @param knownBounds границы нормирования, если они уже посчитаны по всей базе.
 * Нужны, когда рейтинг считается не для всех программ сразу: реестру вузов хватает
 * программ показанной страницы, но нормировать по ним нельзя — шкала получится
 * своя на каждой странице. Тогда границы берутся одним агрегатом по всей базе,
 * а строк читается на два порядка меньше.
 */
export function calculateRatings(
  programs: readonly RatingInput[],
  knownBounds?: RatingBounds,
): Map<string, ProgramRatingDto> {
  const bounds = knownBounds ?? boundsFromPrograms(programs)

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
      // От нуля, а не от минимума выборки (решение 98): иначе реальная программа
      // со 150 заявками получит 0,0 только потому, что у других больше.
      // Ноль баллов — только у нуля заявок. Минимум в границах остаётся для объяснения.
      const normalized = round(normalize(value, 0, factorBounds.max), 3)
      weightedSum += normalized * weight
      usedWeight += weight

      factors.push({
        key: factor,
        title: PROGRAM_RATING_LABELS[factor],
        value,
        normalized,
        weight,
        contribution: null,
      })
    }

    const hasEnoughData = filled >= RATING_MIN_FILLED_FACTORS && usedWeight > 0
    const score = hasEnoughData ? round((weightedSum / usedWeight) * RATING_SCALE, 1) : null

    // Вклад — доля в итоговом балле, поэтому делится на вес, который реально
    // учтён: при пустом показателе балл пересчитан на оставшиеся веса, и вклады
    // без этого не сложатся в балл.
    if (hasEnoughData) {
      for (const item of factors) {
        if (item.normalized === null) continue
        item.contribution = round((item.normalized * item.weight * RATING_SCALE) / usedWeight, 2)
      }
    }
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
 * «Нет данных» — это не ноль.
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
              : `Нет данных: показатели рейтинга не заполнены ни у одной из ${countWithNoun(programCount, PROGRAM_FORMS_OF)} вуза`,
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
