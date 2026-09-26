import { afterEach, describe, expect, it } from 'vitest'
import { consumeLinkCode, createLinkCode, resetSpentLinkCodes, verifyLinkCode } from './notify-channels.link-token'

/**
 * Код привязки MAX/VK (решение 144) — тот же приём, что у Telegram
 * (telegram.link-token.ts): HMAC, срок, один раз, ничего в базе.
 */

const SECRET = 'auth-secret-for-tests'

afterEach(() => {
  resetSpentLinkCodes()
})

describe('createLinkCode / verifyLinkCode', () => {
  it('код проверяется и отдаёт того же пользователя и канал', () => {
    const now = Date.now()
    const { code, expiresAt } = createLinkCode(SECRET, 'user-1', 'max', now)
    const verified = verifyLinkCode(SECRET, code, now)
    expect(verified).toEqual({ userId: 'user-1', channel: 'max', expiresAt })
  })

  it('канал кодируется в коде: max и vk дают разные коды для того же пользователя', () => {
    const now = Date.now()
    const maxCode = createLinkCode(SECRET, 'user-1', 'max', now).code
    const vkCode = createLinkCode(SECRET, 'user-1', 'vk', now).code
    expect(maxCode).not.toBe(vkCode)
    expect(verifyLinkCode(SECRET, vkCode, now)?.channel).toBe('vk')
  })

  it('истёкший код — null', () => {
    const now = Date.now()
    const { code } = createLinkCode(SECRET, 'user-1', 'max', now)
    expect(verifyLinkCode(SECRET, code, now + 16 * 60_000)).toBeNull()
  })

  it('чужой секрет не проверяется', () => {
    const now = Date.now()
    const { code } = createLinkCode(SECRET, 'user-1', 'max', now)
    expect(verifyLinkCode('другой-секрет', code, now)).toBeNull()
  })

  it('подделанный код (изменён последний символ) — null', () => {
    const now = Date.now()
    const { code } = createLinkCode(SECRET, 'user-1', 'max', now)
    const tampered = code.slice(0, -1) + (code.at(-1) === 'A' ? 'B' : 'A')
    expect(verifyLinkCode(SECRET, tampered, now)).toBeNull()
  })

  it('мусор вместо кода — null, не бросает', () => {
    expect(verifyLinkCode(SECRET, '', Date.now())).toBeNull()
    expect(verifyLinkCode(SECRET, 'not-base64url-!!!', Date.now())).toBeNull()
    expect(verifyLinkCode(SECRET, 'a'.repeat(500), Date.now())).toBeNull()
  })
})

describe('consumeLinkCode — одноразовость', () => {
  it('срабатывает один раз: повтор того же кода — null', () => {
    const now = Date.now()
    const { code } = createLinkCode(SECRET, 'user-1', 'vk', now)
    expect(consumeLinkCode(SECRET, code, now)).toEqual({ userId: 'user-1', channel: 'vk', expiresAt: expect.any(Date) })
    expect(consumeLinkCode(SECRET, code, now)).toBeNull()
  })

  it('verifyLinkCode не отмечает использование — только consumeLinkCode', () => {
    const now = Date.now()
    const { code } = createLinkCode(SECRET, 'user-1', 'max', now)
    expect(verifyLinkCode(SECRET, code, now)).not.toBeNull()
    expect(verifyLinkCode(SECRET, code, now)).not.toBeNull()
    expect(consumeLinkCode(SECRET, code, now)).not.toBeNull()
    expect(consumeLinkCode(SECRET, code, now)).toBeNull()
  })
})
