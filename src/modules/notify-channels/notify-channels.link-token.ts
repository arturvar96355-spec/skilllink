import { createHmac, timingSafeEqual } from 'node:crypto'
import { CHANNEL_LINK } from '@/shared/config/notify-channels.config'
import type { AltChannelId } from './notify-channels.types'

/**
 * Код привязки чата MAX/VK к пользователю (решение 144) — тот же приём, что
 * `telegram.link-token.ts` (решение 102): подписанный HMAC, без хранения в базе.
 * Личный кабинет отдаёт ссылку с кодом, канал присылает его назад в первом
 * сообщении (MAX — диплинк `/start/<код>`, VK — `?ref=<код>`), и только тогда
 * появляется привязка.
 *
 * Формат (байты, затем base64url): 4 — срок в секундах, 12 — подпись, 1 — канал
 * (0 = MAX, 1 = VK), дальше — id пользователя.
 */

const EXPIRY_BYTES = 4
const MAC_BYTES = 12
const CHANNEL_BYTES = 1
const CODE_PATTERN = /^[A-Za-z0-9_-]+$/
/** С запасом: VK принимает ref до 255 знаков, MAX — заведомо больше, чем нужно cuid. */
const MAX_CODE_LENGTH = 200

const CHANNEL_TAG: Record<'MAX' | 'VK', number> = { MAX: 0, VK: 1 }
const TAG_CHANNEL: Record<number, 'MAX' | 'VK'> = { 0: 'MAX', 1: 'VK' }

const linkKey = (secret: string): Buffer =>
  createHmac('sha256', secret).update('skilllink:channel-link').digest()

const mac = (secret: string, userId: string, channel: string, expiresAtSec: number): Buffer =>
  createHmac('sha256', linkKey(secret)).update(`${channel}.${userId}.${expiresAtSec}`).digest().subarray(0, MAC_BYTES)

export interface LinkCode {
  code: string
  expiresAt: Date
}

export function createLinkCode(
  secret: string,
  userId: string,
  channel: Exclude<AltChannelId, 'telegram'>,
  now = Date.now(),
): LinkCode {
  const tag = channel === 'max' ? 'MAX' : 'VK'
  const expiresAtSec = Math.floor((now + CHANNEL_LINK.ttlMs) / 1000)
  const expiry = Buffer.alloc(EXPIRY_BYTES)
  expiry.writeUInt32BE(expiresAtSec)
  const code = Buffer.concat([
    expiry,
    mac(secret, userId, tag, expiresAtSec),
    Buffer.from([CHANNEL_TAG[tag]]),
    Buffer.from(userId, 'utf8'),
  ]).toString('base64url')
  if (code.length > MAX_CODE_LENGTH) {
    throw new Error('Идентификатор пользователя слишком длинный для кода привязки')
  }
  return { code, expiresAt: new Date(expiresAtSec * 1000) }
}

export interface VerifiedLinkCode {
  userId: string
  channel: 'max' | 'vk'
  expiresAt: Date
}

/** Проверяет код и отдаёт, чей он и для какого канала. Всё остальное — null. */
export function verifyLinkCode(secret: string, code: string, now = Date.now()): VerifiedLinkCode | null {
  if (code.length === 0 || code.length > MAX_CODE_LENGTH || !CODE_PATTERN.test(code)) return null
  const bytes = Buffer.from(code, 'base64url')
  if (bytes.length <= EXPIRY_BYTES + MAC_BYTES + CHANNEL_BYTES) return null

  const expiresAtSec = bytes.readUInt32BE(0)
  const expiresAtMs = expiresAtSec * 1000
  if (expiresAtMs <= now) return null
  if (expiresAtMs > now + CHANNEL_LINK.ttlMs + 60_000) return null

  const tagByte = bytes[EXPIRY_BYTES + MAC_BYTES]
  const tag = TAG_CHANNEL[tagByte]
  if (!tag) return null
  const userId = bytes.subarray(EXPIRY_BYTES + MAC_BYTES + CHANNEL_BYTES).toString('utf8')
  const received = bytes.subarray(EXPIRY_BYTES, EXPIRY_BYTES + MAC_BYTES)
  if (!timingSafeEqual(received, mac(secret, userId, tag, expiresAtSec))) return null
  return { userId, channel: tag === 'MAX' ? 'max' : 'vk', expiresAt: new Date(expiresAtMs) }
}

// ── Одноразовость (память процесса — как у Telegram, см. docs/SECURITY_LIMITATIONS.md) ──

const spent = new Map<string, number>()

function remember(code: string, expiresAt: number, now: number): void {
  if (spent.size >= CHANNEL_LINK.maxRemembered) {
    for (const [key, expires] of spent) if (expires <= now) spent.delete(key)
  }
  while (spent.size >= CHANNEL_LINK.maxRemembered) {
    const oldest = spent.keys().next().value
    if (oldest === undefined) break
    spent.delete(oldest)
  }
  spent.set(code, expiresAt)
}

export function consumeLinkCode(secret: string, code: string, now = Date.now()): VerifiedLinkCode | null {
  const verified = verifyLinkCode(secret, code, now)
  if (!verified || spent.has(code)) return null
  remember(code, verified.expiresAt.getTime(), now)
  return verified
}

/** Только для тестов. */
export function resetSpentLinkCodes(): void {
  spent.clear()
}
