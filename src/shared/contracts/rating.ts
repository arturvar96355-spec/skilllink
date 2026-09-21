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
