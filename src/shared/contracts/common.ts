/**
 * Общие типы ответов API: мета списка, коды ошибок, показатель с происхождением.
 * Формат зафиксирован в CLAUDE.md и docs/API_CONTRACT.md.
 */

export interface PageMeta {
  page: number
  pageSize: number
  total: number
}

export type ApiErrorCode =
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'UNAUTHORIZED'
  | 'CONFLICT'
  | 'INVALID_TRANSITION'
  | 'INTEGRATION_ERROR'
  | 'INTERNAL'

/** Происхождение показателя. Обязательно для всего, что считается системой (решение 8). */
export type MetricBasis = 'actual' | 'estimate' | 'none'

/**
 * Числовой показатель вместе с его происхождением.
 * value === null означает «Нет данных» — никогда не подменяется нулём.
 */
export interface Metric {
  value: number | null
  unit: string
  basis: MetricBasis
  /** Что именно посчитано и по каким данным — текст для подсказки на фронте. */
  explanation: string
  period?: string | null
  source?: string | null
  isMock?: boolean
}
