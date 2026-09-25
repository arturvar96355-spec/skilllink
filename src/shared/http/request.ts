import { z } from '@/shared/zod'
import { findNul } from '@/shared/db/storable'
import { AppError, fromZod, validationError } from './errors'

/**
 * Символ с кодом 0 база не примет ни в записи, ни в поиске (shared/db/storable.ts).
 * Останавливаем его здесь, вместе с остальной проверкой входа: иначе он дойдёт
 * до запроса и вернётся как «Внутренняя ошибка сервера».
 */
function rejectNul(raw: unknown, message: string): void {
  const field = findNul(raw)
  if (field === null) return
  throw validationError(message, [
    { field, message: 'Содержит недопустимый символ с кодом 0 — уберите его' },
  ])
}

/**
 * Больше этого тело JSON не читаем. Самая большая форма системы — встреча
 * с участниками и итогами — укладывается в десятки килобайт.
 */
export const MAX_JSON_BODY_BYTES = 1024 * 1024

/**
 * Тело запроса байтами, но не больше `limit`.
 *
 * `request.json()`, `.text()` и `.arrayBuffer()` читают тело целиком, сколько бы
 * его ни было. Заголовок `Content-Length` при потоковой передаче (chunked)
 * отсутствует, поэтому любой вошедший — хоть наблюдатель — может прислать
 * гигабайты, и процесс держал бы их в памяти до проверки размера. Здесь тело
 * читается кусками, и чтение обрывается, как только предел превышен.
 */
export async function readBodyBytes(
  request: Request,
  limit: number,
  tooLarge: () => AppError,
): Promise<Uint8Array> {
  const declared = Number(request.headers.get('content-length') ?? 0)
  if (declared > limit) throw tooLarge()
  if (!request.body) return new Uint8Array(0)

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > limit) {
      await reader.cancel()
      throw tooLarge()
    }
    chunks.push(value)
  }

  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

const jsonTooLarge = (): AppError =>
  validationError('Тело запроса слишком большое', [
    { field: '_', message: `Допустимо не больше ${MAX_JSON_BODY_BYTES / 1024 / 1024} МБ` },
  ])

async function readBodyText(request: Request): Promise<string> {
  return new TextDecoder().decode(await readBodyBytes(request, MAX_JSON_BODY_BYTES, jsonTooLarge))
}

/** Читает и валидирует тело запроса. Некорректный JSON — тоже ошибка валидации. */
export async function parseBody<S extends z.ZodType>(
  request: Request,
  schema: S,
): Promise<z.infer<S>> {
  const text = await readBodyText(request)
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new AppError('VALIDATION_ERROR', 'Тело запроса должно быть корректным JSON')
  }
  rejectNul(raw, 'Ошибка валидации данных')
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
  const raw = await readBodyText(request)
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

  rejectNul(parsedJson, 'Ошибка валидации данных')
  const parsed = schema.safeParse(parsedJson)
  if (!parsed.success) throw fromZod(parsed.error)
  return parsed.data
}

/**
 * Валидирует query-параметры.
 * Повторяющиеся ключи (?status=A&status=B) собираются в массив — так работают фильтры списков.
 *
 * Пустое значение — то же, что его отсутствие, и значение из одних пробелов тоже:
 * схемы обрезают пробелы, и без этого `?q=%20` превращался бы в отказ «введите
 * хотя бы один символ» — поиск из пробела ломал бы таблицу ошибкой.
 */
export function parseQuery<S extends z.ZodType>(request: Request, schema: S): z.infer<S> {
  const params = new URL(request.url).searchParams
  const raw: Record<string, string | string[]> = {}
  for (const key of new Set(params.keys())) {
    const values = params.getAll(key).filter((value) => value.trim() !== '')
    if (values.length === 0) continue
    raw[key] = values.length === 1 ? (values[0] as string) : values
  }
  rejectNul(raw, 'Некорректные параметры запроса')
  const parsed = schema.safeParse(raw)
  if (!parsed.success) throw fromZod(parsed.error, 'Некорректные параметры запроса')
  return parsed.data
}
