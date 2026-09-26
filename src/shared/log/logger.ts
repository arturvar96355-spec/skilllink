import { redact, redactString } from './redact'
import { currentRequestId } from './request-context'

/**
 * Общий журнал сервера (решение 133): одна строка JSON на событие —
 * `{ ts, level, msg, requestId, …поля }`. Сборщик логов разбирает её без
 * регулярных выражений, а человек находит все строки одного запроса по номеру.
 *
 * Всё, что передано полями, проходит `redact()`: секреты по имени поля и по виду
 * значения, почта и телефоны — маской. Ошибку передавайте полем `err` — от неё
 * останутся имя, код, сообщение без данных запроса, стек и причина.
 *
 * Пишет в stdout/stderr через console: так строки видит `docker logs`, а тесты
 * могут перехватить вывод. Фронт этот журнал не использует.
 */

export type LogLevel = 'info' | 'warn' | 'error'
export type LogFields = Record<string, unknown>

type Sink = (line: string) => void

const defaultSinks: Record<LogLevel, Sink> = {
  info: (line) => console.log(line),
  warn: (line) => console.warn(line),
  error: (line) => console.error(line),
}

let sinks: Record<LogLevel, Sink> = defaultSinks

/** Строка журнала — отдельно от вывода, чтобы её можно было проверить в тесте. */
export function formatLogLine(level: LogLevel, msg: string, fields: LogFields = {}, now = new Date()): string {
  const requestId = currentRequestId()
  const safeFields = redact(fields) as Record<string, unknown>
  // Служебные ключи не перетираются полями вызова.
  const { ts: _ts, level: _level, msg: _msg, requestId: fieldRequestId, ...rest } = safeFields
  const record: Record<string, unknown> = {
    ts: now.toISOString(),
    level,
    msg: redactString(msg),
    ...(requestId ? { requestId } : typeof fieldRequestId === 'string' ? { requestId: fieldRequestId } : {}),
    ...rest,
  }
  try {
    return JSON.stringify(record)
  } catch {
    return JSON.stringify({ ts: record.ts, level, msg: record.msg, requestId: record.requestId, note: 'поля не сериализуются' })
  }
}

function emit(level: LogLevel, msg: string, fields?: LogFields): void {
  try {
    sinks[level](formatLogLine(level, msg, fields))
  } catch {
    // Журнал не должен ронять запрос ни при каких данных.
  }
}

export const log = {
  info: (msg: string, fields?: LogFields) => emit('info', msg, fields),
  warn: (msg: string, fields?: LogFields) => emit('warn', msg, fields),
  error: (msg: string, fields?: LogFields) => emit('error', msg, fields),
}

/** Только для тестов: перехватить вывод. Возвращает функцию восстановления. */
export function captureLog(sink: (level: LogLevel, line: string) => void): () => void {
  sinks = {
    info: (line) => sink('info', line),
    warn: (line) => sink('warn', line),
    error: (line) => sink('error', line),
  }
  return () => {
    sinks = defaultSinks
  }
}
