import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import { LOGIN_CAPTCHA } from '@/shared/config/auth.config'

/**
 * Проверка «не робот» на входе — задача на вычисление (решение 100).
 *
 * Сервер загадывает число от 0 до maxNumber и отдаёт хеш SHA-256 от «соль + число»,
 * подписанный своим ключом. Браузер перебирает числа, пока хеш не совпадёт, и
 * присылает найденное вместе с задачей. Проверка — один хеш и одна подпись.
 *
 * Своя, а не внешний сервис: не нужны ключи, данные посетителя никуда не уходят
 * (152-ФЗ), вход не зависит от доступности чужого сервера. Честная граница —
 * в docs/SECURITY_LIMITATIONS.md: программа без браузера решает такую задачу
 * быстрее человека, поэтому задача только удорожает перебор, а останавливает
 * его по-прежнему ограничение попыток (throttle.ts).
 */

export const CAPTCHA_ALGORITHM = 'SHA-256'

/** Задача, которую получает браузер. */
export interface CaptchaChallenge {
  algorithm: typeof CAPTCHA_ALGORITHM
  /** Хеш SHA-256 от `salt + число`, шестнадцатеричный. */
  challenge: string
  /** Случайная часть и срок жизни задачи. */
  salt: string
  maxNumber: number
  /** Подпись сервера над `challenge`: задачу нельзя придумать самому. */
  signature: string
}

/** Решение, которое браузер присылает вместе с паролем. */
export interface CaptchaSolution {
  algorithm: string
  challenge: string
  salt: string
  number: number
  signature: string
}

/**
 * Соль: 24 шестнадцатеричных знака, точка, срок жизни в миллисекундах (13 цифр), точка.
 *
 * Длина срока фиксирована и закрыта точкой. Иначе хеш от «соль + число» не отличал
 * бы, где кончается срок и начинается число: из решения «…1727270000000» + «12»
 * получалось бы «…17272700000001» + «2» — тот же хеш со сроком в десять раз дальше,
 * и одну решённую задачу можно было бы предъявлять годами.
 */
const SALT_PATTERN = /^[0-9a-f]{24}\.(\d{13})\.$/
const HEX_64 = /^[0-9a-f]{64}$/

const sha256Hex = (text: string): string => createHash('sha256').update(text).digest('hex')

/**
 * Ключ подписи задач — производный от секрета сессий, а не он сам: подпись задачи
 * никогда не совпадёт ни с одной подписью токена.
 */
const signingKey = (secret: string): Buffer =>
  createHmac('sha256', secret).update('skilllink:login-captcha').digest()

const sign = (secret: string, challenge: string): string =>
  createHmac('sha256', signingKey(secret)).update(challenge).digest('hex')

export function createChallenge(secret: string, now = Date.now()): CaptchaChallenge {
  const salt = `${randomBytes(12).toString('hex')}.${now + LOGIN_CAPTCHA.ttlMs}.`
  const challenge = sha256Hex(salt + randomInt(0, LOGIN_CAPTCHA.maxNumber + 1))
  return {
    algorithm: CAPTCHA_ALGORITHM,
    challenge,
    salt,
    maxNumber: LOGIN_CAPTCHA.maxNumber,
    signature: sign(secret, challenge),
  }
}

/**
 * Решение из поля формы входа: строка JSON. Всё, что не похоже на решение, — null.
 */
export function parseSolution(raw: unknown): CaptchaSolution | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 1_000) return null
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof value !== 'object' || value === null) return null
  const { algorithm, challenge, salt, number, signature } = value as Record<string, unknown>
  if (
    typeof algorithm !== 'string' ||
    typeof challenge !== 'string' ||
    typeof salt !== 'string' ||
    typeof number !== 'number' ||
    typeof signature !== 'string'
  ) {
    return null
  }
  return { algorithm, challenge, salt, number, signature }
}

// ── Предъявленные решения ────────────────────────────────────────────────────

/**
 * Решённые задачи со сроком жизни — одну задачу нельзя предъявить дважды.
 * Живут в памяти процесса, как и счётчики попыток (throttle.ts): перезапуск их
 * обнуляет, но задачи старше перезапуска к тому моменту почти все истекли.
 */
const spent = new Map<string, number>()

function remember(challenge: string, expiresAt: number, now: number): void {
  if (spent.size >= LOGIN_CAPTCHA.maxRemembered) {
    for (const [key, expires] of spent) if (expires <= now) spent.delete(key)
  }
  // Истёкших не нашлось — уходит самая старая: задача, предъявленная давно,
  // скорее всего уже истекла, а отказать новому посетителю хуже.
  while (spent.size >= LOGIN_CAPTCHA.maxRemembered) {
    const oldest = spent.keys().next().value
    if (oldest === undefined) break
    spent.delete(oldest)
  }
  spent.set(challenge, expiresAt)
}

/**
 * Проверяет решение и, если оно верно, помечает задачу использованной.
 *
 * Синхронно, без `await`: вызов и пометка идут подряд, и два одновременных
 * запроса с одним решением не пройдут оба.
 */
export function verifySolution(
  solution: CaptchaSolution | null,
  secret: string,
  now = Date.now(),
): boolean {
  if (solution === null) return false
  const { algorithm, challenge, salt, number, signature } = solution
  if (algorithm !== CAPTCHA_ALGORITHM) return false
  if (!HEX_64.test(challenge) || !HEX_64.test(signature)) return false

  const expiresAt = Number(SALT_PATTERN.exec(salt)?.[1] ?? Number.NaN)
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return false
  if (!Number.isSafeInteger(number) || number < 0 || number > LOGIN_CAPTCHA.maxNumber) return false

  if (sha256Hex(salt + number) !== challenge) return false
  const expected = Buffer.from(sign(secret, challenge), 'hex')
  if (!timingSafeEqual(expected, Buffer.from(signature, 'hex'))) return false

  if (spent.has(challenge)) return false
  remember(challenge, expiresAt, now)
  return true
}

/** Только для тестов: предъявленные решения между ними протекать не должны. */
export function resetCaptcha(): void {
  spent.clear()
}
