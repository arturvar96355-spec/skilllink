import { beforeEach, describe, expect, it } from 'vitest'
import { LOGIN_THROTTLE } from '@/shared/config/auth.config'
import {
  checkLogin,
  isBlocked,
  recordFailure,
  recordSuccess,
  registerFailure,
  resetThrottle,
  secondsUntilUnblocked,
  throttledAttempt,
} from './throttle'

const NOW = 1_700_000_000_000

describe('счётчик неудачных попыток', () => {
  it('первая неудача не блокирует', () => {
    const state = registerFailure(undefined, NOW)
    expect(state.failures).toBe(1)
    expect(state.blockedUntil).toBeNull()
  })

  it('блокирует ровно на заданной попытке, не раньше', () => {
    let state = registerFailure(undefined, NOW)
    for (let attempt = 2; attempt < LOGIN_THROTTLE.maxFailures; attempt += 1) {
      state = registerFailure(state, NOW)
      expect(state.blockedUntil).toBeNull()
    }
    state = registerFailure(state, NOW)
    expect(state.blockedUntil).not.toBeNull()
    expect(isBlocked(state, NOW)).toBe(true)
  })

  it('окно скользит: редкие опечатки не копятся в блокировку', () => {
    let state = registerFailure(undefined, NOW)
    for (let attempt = 0; attempt < LOGIN_THROTTLE.maxFailures + 3; attempt += 1) {
      // Каждая следующая попытка — уже за пределами окна.
      state = registerFailure(state, NOW + (attempt + 1) * (LOGIN_THROTTLE.windowMs + 1000))
      expect(state.failures).toBe(1)
      expect(state.blockedUntil).toBeNull()
    }
  })

  it('блокировка снимается сама по истечении срока', () => {
    let state = registerFailure(undefined, NOW)
    for (let attempt = 1; attempt < LOGIN_THROTTLE.maxFailures; attempt += 1) {
      state = registerFailure(state, NOW)
    }
    expect(isBlocked(state, NOW)).toBe(true)
    expect(isBlocked(state, NOW + LOGIN_THROTTLE.blockMs + 1)).toBe(false)
  })

  it('попытки во время блокировки её не продлевают', () => {
    let state = registerFailure(undefined, NOW)
    for (let attempt = 1; attempt < LOGIN_THROTTLE.maxFailures; attempt += 1) {
      state = registerFailure(state, NOW)
    }
    const until = state.blockedUntil
    // Иначе непрерывный перебор держал бы учётную запись закрытой вечно,
    // и это стало бы способом заблокировать чужой вход.
    state = registerFailure(state, NOW + 1000)
    state = registerFailure(state, NOW + 2000)
    expect(state.blockedUntil).toBe(until)
  })

  it('считает остаток блокировки в секундах', () => {
    let state = registerFailure(undefined, NOW)
    for (let attempt = 1; attempt < LOGIN_THROTTLE.maxFailures; attempt += 1) {
      state = registerFailure(state, NOW)
    }
    expect(secondsUntilUnblocked(state, NOW)).toBe(LOGIN_THROTTLE.blockMs / 1000)
    expect(secondsUntilUnblocked(state, NOW + LOGIN_THROTTLE.blockMs)).toBe(0)
  })
})

describe('хранилище попыток', () => {
  beforeEach(() => {
    resetThrottle()
  })

  it('учётные записи считаются независимо', () => {
    for (let attempt = 0; attempt < LOGIN_THROTTLE.maxFailures; attempt += 1) {
      recordFailure('first@example.invalid', NOW)
    }
    expect(checkLogin('first@example.invalid', NOW).blocked).toBe(true)
    expect(checkLogin('second@example.invalid', NOW).blocked).toBe(false)
  })

  it('удачный вход обнуляет счётчик', () => {
    for (let attempt = 0; attempt < LOGIN_THROTTLE.maxFailures - 1; attempt += 1) {
      recordFailure('user@example.invalid', NOW)
    }
    recordSuccess('user@example.invalid')
    recordFailure('user@example.invalid', NOW)
    expect(checkLogin('user@example.invalid', NOW).blocked).toBe(false)
  })

  it('перебор по случайным адресам не растит карту без предела', () => {
    for (let index = 0; index < LOGIN_THROTTLE.maxTrackedAccounts + 500; index += 1) {
      recordFailure(`random-${index}@example.invalid`, NOW)
    }
    // Предел соблюдён: иначе перебор по несуществующим адресам стал бы способом
    // израсходовать память процесса.
    expect(checkLogin('random-0@example.invalid', NOW).blocked).toBe(false)
  })

  it('неизвестная учётная запись не заблокирована', () => {
    expect(checkLogin('nobody@example.invalid', NOW)).toEqual({
      blocked: false,
      retryAfterSeconds: 0,
    })
  })
})

describe('одновременные попытки входа', () => {
  beforeEach(() => {
    resetThrottle()
  })

  /** Проверка пароля, которая, как bcrypt, занимает время. */
  const slowWrongPassword = async (): Promise<null> => {
    await new Promise((resolve) => setTimeout(resolve, 5))
    return null
  }

  it('сто одновременных догадок — проверяется не больше пяти', async () => {
    // Раньше неудача записывалась после запроса к базе и bcrypt, и все сто
    // проходили проверку блокировки раньше, чем первая успевала записаться.
    let checked = 0
    const attempts = await Promise.all(
      Array.from({ length: 100 }, () =>
        throttledAttempt('target@example.invalid', async () => {
          checked += 1
          return slowWrongPassword()
        }),
      ),
    )
    expect(checked).toBe(LOGIN_THROTTLE.maxFailures)
    expect(attempts.filter((attempt) => attempt.blocked)).toHaveLength(100 - LOGIN_THROTTLE.maxFailures)
  })

  it('верный пароль с последней разрешённой попытки пускает и обнуляет счётчик', async () => {
    for (let index = 0; index < LOGIN_THROTTLE.maxFailures - 1; index += 1) {
      await throttledAttempt('user@example.invalid', slowWrongPassword)
    }
    const success = await throttledAttempt('user@example.invalid', async () => ({ id: 'u1' }))
    expect(success).toEqual({ blocked: false, result: { id: 'u1' } })
    expect(checkLogin('user@example.invalid').blocked).toBe(false)
  })
})

