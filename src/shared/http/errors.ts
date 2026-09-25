import { z } from '@/shared/zod'

/** Коды ошибок и соответствующие им HTTP-статусы. Контракт из CLAUDE.md. */
export const ERROR_STATUS = {
  VALIDATION_ERROR: 422,
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  UNAUTHORIZED: 401,
  CONFLICT: 409,
  INVALID_TRANSITION: 409,
  INTEGRATION_ERROR: 502,
  /** Превышен предел частоты запросов (решение 117). Ответ несёт `Retry-After`. */
  RATE_LIMITED: 429,
  INTERNAL: 500,
} as const

export type ErrorCode = keyof typeof ERROR_STATUS

export interface ErrorDetail {
  field: string
  message: string
}

/** Ошибка, которую слой HTTP умеет превратить в ответ контракта. */
export class AppError extends Error {
  readonly code: ErrorCode
  readonly details?: unknown

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message)
    this.name = 'AppError'
    this.code = code
    this.details = details
  }

  get status(): number {
    return ERROR_STATUS[this.code]
  }
}

export const notFound = (message = 'Запись не найдена'): AppError =>
  new AppError('NOT_FOUND', message)

export const forbidden = (message = 'Недостаточно прав для этого действия'): AppError =>
  new AppError('FORBIDDEN', message)

export const unauthorized = (message = 'Требуется авторизация'): AppError =>
  new AppError('UNAUTHORIZED', message)

export const conflict = (message: string, details?: unknown): AppError =>
  new AppError('CONFLICT', message, details)

export const invalidTransition = (message: string, details?: unknown): AppError =>
  new AppError('INVALID_TRANSITION', message, details)

export const validationError = (message: string, details?: unknown): AppError =>
  new AppError('VALIDATION_ERROR', message, details)

export const integrationError = (message: string, details?: unknown): AppError =>
  new AppError('INTEGRATION_ERROR', message, details)

/** Разворачивает ошибку Zod в плоский список «поле — сообщение». */
export function zodDetails(error: z.ZodError): ErrorDetail[] {
  return error.issues.map((issue) => ({
    field: issue.path.length > 0 ? issue.path.join('.') : '_',
    message: issue.message,
  }))
}

export function fromZod(error: z.ZodError, message = 'Ошибка валидации данных'): AppError {
  return new AppError('VALIDATION_ERROR', message, zodDetails(error))
}
