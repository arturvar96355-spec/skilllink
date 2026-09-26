/**
 * Маскирование секретов и персональных данных перед записью в журнал сервера
 * (решение 123).
 *
 * Журнал процесса читают те, кому база не положена: владелец сервера, сборщик
 * логов, человек, которому переслали кусок вывода. Поэтому всё, что уходит
 * в журнал, проходит через две проверки:
 *
 * - **по ключу** — значение поля с «опасным» именем (password, token, secret,
 *   authorization, cookie, apiKey…) заменяется целиком на любой глубине;
 * - **по значению** — в любой строке (сообщение, адрес, текст и стек ошибки,
 *   её `cause`) вырезаются токен бота Telegram, JWT, `Bearer …`, секреты
 *   в параметрах адреса; почта превращается в `a***@домен`, телефон — в `***1234`.
 *
 * Маскирование — страховка, а не разрешение: модули по-прежнему не пишут в журнал
 * ПД (CLAUDE.md, раздел «Данные»). Функции чистые и не зависят от среды.
 */

export const REDACTED = '[скрыто]'
export const TOKEN_REDACTED = '[токен скрыт]'

/** Глубже этого вложенные объекты не разбираются — журналу хватает верхних уровней. */
const MAX_DEPTH = 6
/** Длиннее строки обрезаются: стек на 50 КБ журналу не нужен. */
const MAX_STRING = 4000
/** Больше элементов массива не пишется. */
const MAX_ARRAY = 50
/** Строк стека ошибки. */
const MAX_STACK_FRAMES = 15

/**
 * Имена полей, значение которых не пишется никогда. Сравнение — по имени
 * в нижнем регистре без `-` и `_`: `api_key`, `apiKey`, `X-Api-Key` — одно и то же.
 */
const SENSITIVE_KEY_PARTS = [
  'password',
  'passwd',
  'passphrase',
  'secret',
  'token',
  'authorization',
  'cookie',
  'apikey',
  'authkey',
  'privatekey',
  'credential',
  'sessionid',
  'signature',
]

export function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[-_\s]/g, '')
  return SENSITIVE_KEY_PARTS.some((part) => normalized.includes(part))
}

/** Токен бота Telegram: `<id бота>:<35 знаков>` — в том числе внутри адреса `/bot<токен>/…`. */
const BOT_TOKEN = /\d+:[A-Za-z0-9_-]{30,}/g
/** JWT (сессия NextAuth и любые другие): три части base64url, первая начинается с `eyJ`. */
const JWT = /eyJ[\w-]*\.[\w-]*(?:\.[\w-]*)?/g
/** Заголовок авторизации, попавший в текст. */
const BEARER = /\b(Bearer|Basic|Api-Key)\s+[A-Za-z0-9._~+/=-]+/gi
/** Секрет в параметре адреса: `?token=…`, `&api_key=…`, `&password=…`. */
const SECRET_QUERY = /([?&](?:[a-z_]*token|[a-z_]*key|[a-z_]*secret|password|sig|signature)=)[^&\s#"']+/gi
/** Рабочая почта: первая буква и домен остаются — по ним видно, чья это ошибка, но не кто. */
const EMAIL = /([A-Za-z0-9])[A-Za-z0-9._%+-]*@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})/g
/** Российский номер в любом написании: +7 (999) 123-45-67, 8 999 123 45 67, 89991234567. */
const PHONE_RU = /(?<![\w+])(?:\+7|8)[\s(-]*\d{3}[\s)-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}(?!\d)/g
/** Международный номер с плюсом: 10–15 цифр с разделителями. */
const PHONE_INTL = /(?<![\w+])\+\d[\d\s()-]{8,20}\d(?!\d)/g

function lastDigits(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  return digits.slice(-4)
}

function maskPhone(match: string): string {
  const digits = match.replace(/\D/g, '').length
  if (digits < 10 || digits > 15) return match
  return `***${lastDigits(match)}`
}

/** Почта для журнала и ответов: `ivanov@univ.ru` → `i***@univ.ru`. */
export function maskEmail(email: string): string {
  return email.replace(EMAIL, (_match, first: string, domain: string) => `${first}***@${domain}`)
}

/**
 * Строка без секретов и ПД. Сначала секреты (токен бота содержит цифры,
 * и телефонное правило иначе съело бы его наполовину), затем почта и телефоны.
 */
export function redactString(text: string): string {
  let result = text.length > MAX_STRING ? `${text.slice(0, MAX_STRING)}…[обрезано]` : text
  result = result
    .replace(BOT_TOKEN, TOKEN_REDACTED)
    .replace(JWT, TOKEN_REDACTED)
    .replace(BEARER, (_match, scheme: string) => `${scheme} ${REDACTED}`)
    .replace(SECRET_QUERY, (_match, prefix: string) => `${prefix}${REDACTED}`)
  result = maskEmail(result)
  result = result.replace(PHONE_RU, maskPhone).replace(PHONE_INTL, maskPhone)
  return result
}

/**
 * Текст ошибки для журнала. Сообщение Prisma повторяет весь вызов с аргументами
 * (ФИО, почта контакта) — от него остаётся последняя строка, как в describeForLog.
 */
function errorMessage(error: Error): string {
  if (!error.name.startsWith('PrismaClient')) return error.message
  const lines = error.message
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
  return lines.at(-1) ?? ''
}

/** Из стека — только строки «at …»: первая строка стека повторяет сообщение целиком. */
function stackFrames(stack: string | undefined): string | undefined {
  if (!stack) return undefined
  const frames = stack
    .split('\n')
    .filter((line) => /^\s+at\s/.test(line))
    .slice(0, MAX_STACK_FRAMES)
    .map((line) => line.trim())
  return frames.length > 0 ? frames.join('\n') : undefined
}

function redactError(error: Error, depth: number, seen: WeakSet<object>): Record<string, unknown> {
  const result: Record<string, unknown> = {
    name: error.name,
    message: redactString(errorMessage(error)),
  }
  const code = (error as { code?: unknown }).code
  if (typeof code === 'string' || typeof code === 'number') result.code = code
  const stack = stackFrames(error.stack)
  if (stack) result.stack = redactString(stack)
  const cause = (error as { cause?: unknown }).cause
  if (cause !== undefined) result.cause = redactValue(cause, depth + 1, seen)
  return result
}

function redactValue(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (value === null || value === undefined) return value
  if (typeof value === 'string') return redactString(value)
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'function' || typeof value === 'symbol') return undefined
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString()
  if (depth >= MAX_DEPTH) return '[вложено глубже]'

  if (typeof value === 'object') {
    if (seen.has(value)) return '[циклическая ссылка]'
    seen.add(value)
    if (value instanceof Error) return redactError(value, depth, seen)
    if (value instanceof URL) return redactString(value.toString())
    if (Array.isArray(value)) {
      const items = value.slice(0, MAX_ARRAY).map((item) => redactValue(item, depth + 1, seen))
      if (value.length > MAX_ARRAY) items.push(`…ещё ${value.length - MAX_ARRAY}`)
      return items
    }
    if (value instanceof Map) return redactValue(Object.fromEntries(value), depth, seen)
    if (typeof Headers !== 'undefined' && value instanceof Headers) {
      return redactValue(Object.fromEntries(value.entries()), depth, seen)
    }
    const result: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) {
      result[key] = isSensitiveKey(key) ? REDACTED : redactValue(item, depth + 1, seen)
    }
    return result
  }
  return String(value)
}

/**
 * Значение любой формы без секретов и ПД: объекты разбираются рекурсивно,
 * ошибки превращаются в `{ name, message, code, stack, cause }`.
 */
export function redact(value: unknown): unknown {
  return redactValue(value, 0, new WeakSet())
}
