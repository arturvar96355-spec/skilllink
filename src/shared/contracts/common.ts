/** Общие обёртки ответов API. Формат зафиксирован в CLAUDE.md и docs/API_CONTRACT.md. */

export interface PageMeta {
  page: number
  pageSize: number
  total: number
}

export interface ApiItemResponse<T> {
  data: T
}

export interface ApiListResponse<T, M extends PageMeta = PageMeta> {
  data: T[]
  meta: M
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

export interface ApiError {
  error: {
    code: ApiErrorCode
    message: string
    details?: unknown
  }
}

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
