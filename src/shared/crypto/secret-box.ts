import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'

/**
 * Шифрование значений, которые приложению нужно прочитать обратно (в отличие от
 * секрета вебхука Telegram, который только сравнивается по хешу) — токен бота
 * Telegram в базе (решение 142).
 *
 * Ключ шифрования — не сам AUTH_SECRET, а производный от него через HKDF с
 * отдельной меткой: тот же приём, что у токена привязки чата Telegram
 * (`telegram-link.ts`, `skilllink:telegram-link`) и у задачи «не робот»
 * (`captcha.ts`) — компрометация одного производного ключа не даёт подписи
 * или ключа шифрования для другого назначения. Отдельного секрета в env нет:
 * это была бы ещё одна переменная, которую можно забыть задать или забыть
 * сменить, а AUTH_SECRET и так проверяется при старте (env.ts).
 *
 * Формат хранения — `nonce|tag|ciphertext`, каждая часть в base64: три отдельных
 * поля вместо одной склеенной строки было бы лишней таблицей ради трёх колонок,
 * а склейка без разделителя не разбиралась бы однозначно (длина nonce и tag
 * фиксирована, но так нагляднее в журнале миграции и при отладке).
 */

const ALGORITHM = 'aes-256-gcm'
const KEY_BYTES = 32
const NONCE_BYTES = 12
const HKDF_LABEL = 'skilllink:system-secret-box'

function deriveKey(secret: string): Buffer {
  return Buffer.from(hkdfSync('sha256', secret, '', HKDF_LABEL, KEY_BYTES))
}

/** Шифрует `plaintext`. `secret` — обычно `resolveSecret()` (AUTH_SECRET). */
export function encryptSecretValue(secret: string, plaintext: string): string {
  const key = deriveKey(secret)
  const nonce = randomBytes(NONCE_BYTES)
  const cipher = createCipheriv(ALGORITHM, key, nonce)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [nonce, tag, ciphertext].map((buffer) => buffer.toString('base64')).join('|')
}

/**
 * Расшифровывает значение из `encryptSecretValue`. `null` — не тот формат, не тот
 * ключ (сменился AUTH_SECRET) или запись повреждена: вызывающий код решает, что
 * делать (обычно — как будто значения в базе нет, есть запасной вариант из env).
 */
export function decryptSecretValue(secret: string, packed: string): string | null {
  const parts = packed.split('|')
  if (parts.length !== 3) return null
  const [nonceB64, tagB64, ciphertextB64] = parts as [string, string, string]
  try {
    const nonce = Buffer.from(nonceB64, 'base64')
    const tag = Buffer.from(tagB64, 'base64')
    const ciphertext = Buffer.from(ciphertextB64, 'base64')
    if (nonce.length !== NONCE_BYTES || tag.length !== 16) return null
    const decipher = createDecipheriv(ALGORITHM, deriveKey(secret), nonce)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
  } catch {
    return null
  }
}
