import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { TELEGRAM_LINK } from '@/shared/config/telegram.config'

/**
 * Токен привязки чата Telegram к пользователю (решение 102) — без хранения.
 *
 * Профиль выдаёт ссылку t.me/<бот>?start=<токен>, Telegram присылает токен в
 * вебхук командой `/start <токен>`. В токене — срок и идентификатор пользователя,
 * подписанные HMAC; подделать чужой или продлить свой нельзя, а таблица
 * одноразовых кодов не нужна.
 *
 * Состав (байты, затем base64url): 4 — срок в секундах, 12 — подпись, дальше —
 * id пользователя. Для cuid из 25 знаков это 55 символов при пределе Telegram 64.
 * Подпись усечена до 96 бит: токен живёт 15 минут, перебор за это время
 * невозможен, а длина важнее.
 */

const EXPIRY_BYTES = 4
const MAC_BYTES = 12
const TOKEN_PATTERN = /^[A-Za-z0-9_-]+$/

/**
 * Ключ подписи — производный от секрета сессий, как у задачи «не робот»
 * (captcha.ts): подпись токена привязки не совпадёт ни с одной другой подписью.
 */
const linkKey = (secret: string): Buffer =>
  createHmac('sha256', secret).update('skilllink:telegram-link').digest()

const mac = (secret: string, userId: string, expiresAtSec: number): Buffer =>
  createHmac('sha256', linkKey(secret)).update(`${userId}.${expiresAtSec}`).digest().subarray(0, MAC_BYTES)

export interface LinkToken {
  token: string
  expiresAt: Date
}

export function createLinkToken(secret: string, userId: string, now = Date.now()): LinkToken {
  const expiresAtSec = Math.floor((now + TELEGRAM_LINK.ttlMs) / 1000)
  const expiry = Buffer.alloc(EXPIRY_BYTES)
  expiry.writeUInt32BE(expiresAtSec)
  const token = Buffer.concat([expiry, mac(secret, userId, expiresAtSec), Buffer.from(userId, 'utf8')]).toString(
    'base64url',
  )
  if (token.length > TELEGRAM_LINK.maxTokenLength) {
    // cuid всегда короче; сюда попадёт только чужой формат идентификатора.
    throw new Error('Идентификатор пользователя слишком длинный для ссылки Telegram')
  }
  return { token, expiresAt: new Date(expiresAtSec * 1000) }
}

/** Проверяет токен и отдаёт, чей он. Всё, что не токен или истекло, — null. */
export function verifyLinkToken(
  secret: string,
  token: string,
  now = Date.now(),
): { userId: string; expiresAt: Date } | null {
  if (token.length === 0 || token.length > TELEGRAM_LINK.maxTokenLength || !TOKEN_PATTERN.test(token)) return null
  const bytes = Buffer.from(token, 'base64url')
  if (bytes.length <= EXPIRY_BYTES + MAC_BYTES) return null

  const expiresAtSec = bytes.readUInt32BE(0)
  const expiresAtMs = expiresAtSec * 1000
  if (expiresAtMs <= now) return null
  // Срок дальше, чем выдаёт сервер, подписанным быть не может — отсекаем до HMAC.
  if (expiresAtMs > now + TELEGRAM_LINK.ttlMs + 60_000) return null

  const userId = bytes.subarray(EXPIRY_BYTES + MAC_BYTES).toString('utf8')
  const received = bytes.subarray(EXPIRY_BYTES, EXPIRY_BYTES + MAC_BYTES)
  if (!timingSafeEqual(received, mac(secret, userId, expiresAtSec))) return null
  return { userId, expiresAt: new Date(expiresAtMs) }
}

// ── Одноразовость ────────────────────────────────────────────────────────────

/**
 * Использованные токены до конца их срока. В памяти процесса, как решения задачи
 * «не робот»: перезапуск их забывает, но токен живёт 15 минут, а привязка того же
 * чата к тому же человеку повторно ничего не меняет. Граница — в
 * docs/SECURITY_LIMITATIONS.md.
 */
const spent = new Map<string, number>()

function remember(token: string, expiresAt: number, now: number): void {
  if (spent.size >= TELEGRAM_LINK.maxRemembered) {
    for (const [key, expires] of spent) if (expires <= now) spent.delete(key)
  }
  while (spent.size >= TELEGRAM_LINK.maxRemembered) {
    const oldest = spent.keys().next().value
    if (oldest === undefined) break
    spent.delete(oldest)
  }
  spent.set(token, expiresAt)
}

/**
 * Проверка с отметкой «использован». Синхронно: два одновременных `/start`
 * с одной ссылкой не пройдут оба.
 */
export function consumeLinkToken(
  secret: string,
  token: string,
  now = Date.now(),
): { userId: string; expiresAt: Date } | null {
  const verified = verifyLinkToken(secret, token, now)
  if (!verified || spent.has(token)) return null
  remember(token, verified.expiresAt.getTime(), now)
  return verified
}

/** Только для тестов. */
export function resetSpentLinkTokens(): void {
  spent.clear()
}

// ── Секрет вебхука ───────────────────────────────────────────────────────────

/**
 * Заголовок X-Telegram-Bot-Api-Secret-Token против заданного в setWebhook.
 *
 * Сравнение — `timingSafeEqual` по SHA-256 обоих значений: у хешей одна длина,
 * и время сравнения не выдаёт ни длину секрета, ни совпавшее начало.
 * Секрет не задан — вебхук закрыт для всех: принимать обновления без проверки
 * значит дать любому писать от имени Telegram.
 */
export function isWebhookSecretValid(received: string | null, expected: string | null): boolean {
  if (!expected || received === null) return false
  const digest = (value: string) => createHash('sha256').update(value).digest()
  return timingSafeEqual(digest(received), digest(expected))
}
