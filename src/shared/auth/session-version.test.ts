import { describe, expect, it } from 'vitest'
import {
  RENEWAL_TTL_MS,
  isSessionCurrent,
  renewedSessionVersion,
  signSessionRenewal,
  tokenSessionVersion,
  verifySessionRenewal,
} from './session-version'

/** Отзыв сессий (решение 109): сверка версии и подписанное продление. */

const SECRET = 'тестовый-секрет-сессий'
const NOW = Date.UTC(2026, 8, 25, 20, 0, 0)

describe('версия сессии в токене', () => {
  it('токен без версии (выдан до миграции) — версия 0: выкладка никого не разлогинивает', () => {
    expect(tokenSessionVersion(undefined)).toBe(0)
    expect(tokenSessionVersion(null)).toBe(0)
    expect(isSessionCurrent(undefined, 0)).toBe(true)
  })

  it('совпала с базой — сессия действует', () => {
    expect(isSessionCurrent(3, 3)).toBe(true)
  })

  it('в базе версия выше — сессия отозвана', () => {
    expect(isSessionCurrent(0, 1)).toBe(false)
    expect(isSessionCurrent(undefined, 1)).toBe(false)
    expect(isSessionCurrent(2, 5)).toBe(false)
  })

  it('в токене версия выше базы (база перезалита) — тоже не совпадает', () => {
    expect(isSessionCurrent(4, 0)).toBe(false)
  })

  it('не число — не наша запись: не совпадает ни с какой версией', () => {
    for (const value of ['0', 1.5, -1, Number.NaN, {}, true]) {
      expect(tokenSessionVersion(value)).toBe(-1)
      expect(isSessionCurrent(value, 0)).toBe(false)
    }
  })
})

describe('разрешение на продление текущей сессии', () => {
  const renewal = { userId: 'u1', from: 2, to: 3 }

  it('подписанное сервером — принимается', () => {
    const grant = signSessionRenewal(renewal, SECRET, NOW)
    expect(verifySessionRenewal(grant, SECRET, NOW + 1000)).toEqual(renewal)
  })

  it('чужим секретом, подделанное или просроченное — нет', () => {
    const grant = signSessionRenewal(renewal, SECRET, NOW)
    expect(verifySessionRenewal(grant, 'другой-секрет', NOW)).toBeNull()
    expect(verifySessionRenewal(grant, SECRET, NOW + RENEWAL_TTL_MS + 1)).toBeNull()

    // Подменить версию в теле, оставив подпись, нельзя.
    const [, signature] = grant.split('.')
    const forged = Buffer.from(JSON.stringify({ u: 'u1', f: 2, t: 99, e: NOW + 5000 })).toString('base64url')
    expect(verifySessionRenewal(`${forged}.${signature}`, SECRET, NOW)).toBeNull()
  })

  it('мусор вместо разрешения — null, без исключений', () => {
    for (const value of [undefined, null, 42, '', 'abc', 'a.b.c', 'x'.repeat(5000), { sessionRenewal: 'x' }]) {
      expect(verifySessionRenewal(value, SECRET, NOW)).toBeNull()
    }
  })

  it('колбэк jwt меняет версию только по верному разрешению для этого токена', () => {
    const grant = signSessionRenewal(renewal, SECRET, NOW)
    const token = { id: 'u1', sessionVersion: 2 }

    expect(renewedSessionVersion(token, { sessionRenewal: grant }, SECRET, NOW)).toBe(3)
    // Чужой пользователь.
    expect(renewedSessionVersion({ id: 'u2', sessionVersion: 2 }, { sessionRenewal: grant }, SECRET, NOW)).toBeNull()
    // Токен уже отозван раньше (версия не та, с которой продлевают) — не оживает.
    expect(renewedSessionVersion({ id: 'u1', sessionVersion: 1 }, { sessionRenewal: grant }, SECRET, NOW)).toBeNull()
  })

  it('клиент своим POST /api/auth/session версию не поднимет', () => {
    const token = { id: 'u1', sessionVersion: 0 }
    for (const data of [{ sessionVersion: 5 }, { user: { sessionVersion: 5 } }, { sessionRenewal: 'u1.5' }, null, 'update']) {
      expect(renewedSessionVersion(token, data, SECRET, NOW)).toBeNull()
    }
  })

  it('токен без версии продлевается с версии 0', () => {
    const grant = signSessionRenewal({ userId: 'u1', from: 0, to: 1 }, SECRET, NOW)
    expect(renewedSessionVersion({ id: 'u1' }, { sessionRenewal: grant }, SECRET, NOW)).toBe(1)
  })
})
