import type { ApiErrorCode, PageMeta } from '@/shared/contracts'

/**
 * Обращения к собственному API.
 *
 * Весь фронт ходит на сервер только через эти функции. Причина простая: формат
 * ответа и формат ошибки у нас одинаковые на всех маршрутах (`{ data }` и
 * `{ error: { code, message } }`), и разбирать их в каждом компоненте заново —
 * значит рано или поздно где-то показать пользователю «[object Object]»
 * вместо русского текста ошибки, который сервер уже прислал.
 */

export interface ApiResult<T> {
  data: T
  /** Приходит только у списков. */
  meta?: PageMeta
}

/** Ошибка, у которой есть код и готовый русский текст от сервера. */
export class ApiRequestError extends Error {
  readonly code: ApiErrorCode | 'NETWORK'
  readonly status: number
  readonly details?: unknown

  constructor(message: string, code: ApiErrorCode | 'NETWORK', status: number, details?: unknown) {
    super(message)
    this.name = 'ApiRequestError'
    this.code = code
    this.status = status
    this.details = details
  }
}

/** Ошибки валидации приходят полем и сообщением — форма подсвечивает конкретные поля. */
export interface FieldError {
  field: string
  message: string
}

export function fieldErrors(error: unknown): FieldError[] {
  if (!(error instanceof ApiRequestError) || error.code !== 'VALIDATION_ERROR') return []
  if (!Array.isArray(error.details)) return []
  return error.details.filter(
    (item): item is FieldError =>
      typeof item === 'object' &&
      item !== null &&
      typeof (item as FieldError).field === 'string' &&
      typeof (item as FieldError).message === 'string',
  )
}

export type QueryValue = string | number | boolean | null | undefined | string[]

/**
 * Сборка строки запроса.
 *
 * Пустые значения выбрасываются, а не передаются пустыми: `?q=` сервер считает
 * ошибкой валидации (минимальная длина строки поиска — один символ).
 */
export function buildQuery(params: Record<string, QueryValue>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue
    if (Array.isArray(value)) {
      for (const item of value) if (item !== '') search.append(key, item)
      continue
    }
    search.append(key, String(value))
  }
  const query = search.toString()
  return query === '' ? '' : `?${query}`
}

async function request<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  let response: Response
  try {
    response = await fetch(path, {
      ...init,
      headers: {
        Accept: 'application/json',
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers,
      },
      // Куки сессии идут с каждым запросом: без них сервер ответит 401.
      credentials: 'same-origin',
    })
  } catch {
    // Сеть недоступна — отдельный случай: сервер тут ни при чём, и предлагать
    // «повторить» имеет смысл, в отличие от 403.
    throw new ApiRequestError('Нет связи с сервером. Проверьте подключение.', 'NETWORK', 0)
  }

  const payload: unknown = await response.json().catch(() => null)

  if (!response.ok) {
    const error =
      payload !== null && typeof payload === 'object' && 'error' in payload
        ? (payload as { error: { code: ApiErrorCode; message: string; details?: unknown } }).error
        : null
    throw new ApiRequestError(
      error?.message ?? `Запрос не выполнен (${response.status})`,
      error?.code ?? 'INTERNAL',
      response.status,
      error?.details,
    )
  }

  if (payload === null || typeof payload !== 'object' || !('data' in payload)) {
    throw new ApiRequestError('Сервер вернул неожиданный ответ', 'INTERNAL', response.status)
  }

  return payload as ApiResult<T>
}

export function apiGet<T>(path: string, signal?: AbortSignal): Promise<ApiResult<T>> {
  return request<T>(path, { method: 'GET', signal })
}

export function apiPost<T>(path: string, body?: unknown): Promise<ApiResult<T>> {
  return request<T>(path, {
    method: 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

export function apiPatch<T>(path: string, body: unknown): Promise<ApiResult<T>> {
  return request<T>(path, { method: 'PATCH', body: JSON.stringify(body) })
}

export function apiPut<T>(path: string, body: unknown): Promise<ApiResult<T>> {
  return request<T>(path, { method: 'PUT', body: JSON.stringify(body) })
}
