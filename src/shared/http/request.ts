import { z } from '@/shared/zod'
import { AppError, fromZod } from './errors'

/** Читает и валидирует тело запроса. Некорректный JSON — тоже ошибка валидации. */
export async function parseBody<S extends z.ZodType>(
  request: Request,
  schema: S,
): Promise<z.infer<S>> {
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    throw new AppError('VALIDATION_ERROR', 'Тело запроса должно быть корректным JSON')
  }
  const parsed = schema.safeParse(raw)
  if (!parsed.success) throw fromZod(parsed.error)
  return parsed.data
}

/**
 * То же, что parseBody, но пустое тело допустимо.
 * Нужно там, где все поля необязательны: заставлять клиента слать `{}` — лишняя придирка.
 */
export async function parseOptionalBody<S extends z.ZodType>(
  request: Request,
  schema: S,
): Promise<z.infer<S>> {
  const raw = await request.text()
  if (raw.trim() === '') {
    const empty = schema.safeParse({})
    if (!empty.success) throw fromZod(empty.error)
    return empty.data
  }

  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(raw)
  } catch {
    throw new AppError('VALIDATION_ERROR', 'Тело запроса должно быть корректным JSON')
  }

  const parsed = schema.safeParse(parsedJson)
  if (!parsed.success) throw fromZod(parsed.error)
  return parsed.data
}

/**
 * Валидирует query-параметры.
 * Повторяющиеся ключи (?status=A&status=B) собираются в массив — так работают фильтры списков.
 */
export function parseQuery<S extends z.ZodType>(request: Request, schema: S): z.infer<S> {
  const params = new URL(request.url).searchParams
  const raw: Record<string, string | string[]> = {}
  for (const key of new Set(params.keys())) {
    const values = params.getAll(key).filter((value) => value !== '')
    if (values.length === 0) continue
    raw[key] = values.length === 1 ? (values[0] as string) : values
  }
  const parsed = schema.safeParse(raw)
  if (!parsed.success) throw fromZod(parsed.error, 'Некорректные параметры запроса')
  return parsed.data
}

/** Достаёт параметры маршрута. В Next 15 они приходят промисом. */
export async function routeParams<T>(context: { params: Promise<T> }): Promise<T> {
  return context.params
}
