/** Три показателя рейтинга программы (решение 7). Других в рейтинге нет. */
export type ProgramRatingFactorKey = 'applicationCount' | 'studentCount' | 'groupCount'

export interface RatingFactorDto {
  key: ProgramRatingFactorKey
  title: string
  /** Исходное значение показателя. null — «Нет данных». */
  value: number | null
  /** Значение, приведённое к 0..1 внутри выборки. */
  normalized: number | null
  weight: number
  /** Вклад показателя в итоговый балл. */
  contribution: number | null
}

export interface ProgramRatingDto {
  programId: string
  /** Итоговый балл по шкале 0..100. null, если ни один показатель не заполнен. */
  score: number | null
  basis: 'actual' | 'estimate' | 'none'
  explanation: string
  factors: RatingFactorDto[]
}

/**
 * Рейтинг вуза (пункт 7.2 ТЗ). Агрегат рейтингов его программ — собственных
 * показателей рейтинга у вуза нет.
 *
 * Как и у программы, балл относительный: показатели нормируются внутри всей
 * выборки программ, поэтому сравнивать вузы можно только между собой.
 */
export interface UniversityRatingDto {
  universityId: string
  /** Итоговый балл по шкале 0..100. null — «Нет данных», а не ноль. */
  score: number | null
  basis: 'actual' | 'estimate' | 'none'
  explanation: string
  /** Сколько программ вуза вообще участвует в расчёте. */
  programCount: number
  /** Из них тех, у кого балл удалось посчитать. */
  ratedProgramCount: number
  /** Сильнейшая программа — чтобы балл вуза можно было раскрыть одним кликом. */
  topProgram: { programId: string; name: string; score: number } | null
}
