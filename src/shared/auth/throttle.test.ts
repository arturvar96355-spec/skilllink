import { beforeEach, describe, expect, it } from 'vitest'
import { LOGIN_CAPTCHA, LOGIN_THROTTLE } from '@/shared/config/auth.config'
import {
  UNKNOWN_ADDRESS,
  checkLogin,
  clientAddress,
  forgiveFailure,
  isBlocked,
  needsCaptcha,
  recordFailure,
  recordSuccess,
  registerFailure,
  releaseAccount,
  resetThrottle,
  secondsUntilUnblocked,
  throttledAttempt,
  trackedCounts,
  type LoginSource,
} from './throttle'

const NOW = 1_700_000_000_000

const from = (account: string, address = '203.0.113.10'): LoginSource => ({ account, address })

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
      recordFailure(from('first@example.invalid'), NOW)
    }
    expect(checkLogin(from('first@example.invalid'), NOW).blocked).toBe(true)
    expect(checkLogin(from('second@example.invalid'), NOW).blocked).toBe(false)
  })

  it('чужой адрес не закрывает вход владельцу учётной записи', () => {
    // Раньше счёт шёл по одной учётной записи: пять неверных паролей с любого
    // ноутбука закрывали демо-вход менеджера всем, включая его самого.
    const attacker = from('manager@skilllink.demo', '198.51.100.7')
    for (let attempt = 0; attempt < LOGIN_THROTTLE.maxFailures; attempt += 1) {
      recordFailure(attacker, NOW)
    }
    expect(checkLogin(attacker, NOW).blocked).toBe(true)
    expect(checkLogin(from('manager@skilllink.demo', '203.0.113.10'), NOW).blocked).toBe(false)
  })

  it('с одного адреса нельзя перебирать пароль по многим учётным записям', () => {
    const address = '198.51.100.7'
    // По одной неудаче на учётную запись: ни одна пара до своего предела не дошла.
    for (let index = 0; index < LOGIN_THROTTLE.maxFailuresPerAddress; index += 1) {
      recordFailure(from(`user-${index}@example.invalid`, address), NOW)
    }
    const next = checkLogin(from('fresh@example.invalid', address), NOW)
    expect(next.blocked).toBe(true)
    expect(next.retryAfterSeconds).toBe(LOGIN_THROTTLE.blockMs / 1000)
    // С другого адреса та же учётная запись свободна.
    expect(checkLogin(from('fresh@example.invalid', '203.0.113.10'), NOW).blocked).toBe(false)
  })

  it('перебор одной учётной записи с множества адресов упирается в общий потолок', () => {
    // У каждого адреса свои пять попыток; без общего потолка перебор
    // с тысячи адресов давал бы пять тысяч догадок.
    const perAddress = LOGIN_THROTTLE.maxFailures - 1
    let failures = 0
    for (let index = 0; failures < LOGIN_THROTTLE.maxFailuresPerAccount; index += 1) {
      for (let attempt = 0; attempt < perAddress && failures < LOGIN_THROTTLE.maxFailuresPerAccount; attempt += 1) {
        recordFailure(from('target@example.invalid', `198.51.100.${index}`), NOW)
        failures += 1
      }
    }
    const fresh = checkLogin(from('target@example.invalid', '203.0.113.200'), NOW)
    expect(fresh.blocked).toBe(true)
    // Потолок — по учётной записи: другие с того же адреса входят.
    expect(checkLogin(from('other@example.invalid', '203.0.113.200'), NOW).blocked).toBe(false)
  })

  it('общий потолок учётной записи считается за час, а не за пять минут', () => {
    for (let index = 0; index < LOGIN_THROTTLE.maxFailuresPerAccount - 1; index += 1) {
      // Каждая неудача — с нового адреса и позже окна пары.
      recordFailure(from('slow@example.invalid', `198.51.100.${index}`), NOW + index * 60_000)
    }
    const last = NOW + (LOGIN_THROTTLE.maxFailuresPerAccount - 1) * 60_000
    expect(last - NOW).toBeLessThan(LOGIN_THROTTLE.accountWindowMs)
    recordFailure(from('slow@example.invalid', '203.0.113.1'), last)
    expect(checkLogin(from('slow@example.invalid', '203.0.113.2'), last).blocked).toBe(true)
  })

  it('неудача сообщает, какой счётчик она закрыла, — один раз', () => {
    const source = from('audit@example.invalid')
    for (let attempt = 0; attempt < LOGIN_THROTTLE.maxFailures - 1; attempt += 1) {
      expect(recordFailure(source, NOW)).toEqual([])
    }
    expect(recordFailure(source, NOW)).toEqual(['account-address'])
    expect(recordFailure(source, NOW)).toEqual([])
  })

  it('удачный вход обнуляет счётчик', () => {
    for (let attempt = 0; attempt < LOGIN_THROTTLE.maxFailures - 1; attempt += 1) {
      recordFailure(from('user@example.invalid'), NOW)
    }
    recordSuccess(from('user@example.invalid'), NOW)
    recordFailure(from('user@example.invalid'), NOW)
    expect(checkLogin(from('user@example.invalid'), NOW).blocked).toBe(false)
  })

  it('удачные входы не расходуют попытки адреса', () => {
    // Неудача пишется до проверки пароля, и удачный вход её снимает — иначе
    // двадцать входов коллег из одной сети закрыли бы её целиком.
    for (let index = 0; index < LOGIN_THROTTLE.maxFailuresPerAddress * 2; index += 1) {
      const source = from(`colleague-${index}@example.invalid`)
      recordFailure(source, NOW)
      recordSuccess(source, NOW)
    }
    expect(checkLogin(from('late@example.invalid'), NOW).blocked).toBe(false)
  })

  it('удачный вход снимает с адреса одну неудачу, а не все', () => {
    const state = { failures: 7, windowStartedAt: NOW, blockedUntil: null }
    expect(forgiveFailure(state, LOGIN_THROTTLE.maxFailuresPerAddress)?.failures).toBe(6)
    expect(forgiveFailure({ ...state, failures: 0 }, 20)?.failures).toBe(0)
    expect(forgiveFailure(undefined, 20)).toBeUndefined()
  })

  it('перебор по случайным адресам не растит карту без предела', () => {
    for (let index = 0; index < LOGIN_THROTTLE.maxTrackedKeys + 500; index += 1) {
      recordFailure(from(`random-${index}@example.invalid`, `10.0.${index >> 8}.${index & 255}`), NOW)
    }
    // Предел соблюдён: иначе перебор по несуществующим адресам стал бы способом
    // израсходовать память процесса.
    const counts = trackedCounts()
    expect(counts.byAccountAndAddress).toBeLessThanOrEqual(LOGIN_THROTTLE.maxTrackedKeys)
    expect(counts.byAddress).toBeLessThanOrEqual(LOGIN_THROTTLE.maxTrackedKeys)
    expect(counts.byAccount).toBeLessThanOrEqual(LOGIN_THROTTLE.maxTrackedKeys)
  })

  it('полная карта вытесняет самые старые записи, а не перестаёт считать новые', () => {
    for (let index = 0; index < LOGIN_THROTTLE.maxTrackedKeys; index += 1) {
      recordFailure(from(`random-${index}@example.invalid`, `10.0.${index >> 8}.${index & 255}`), NOW)
    }
    // Раньше новая учётная запись в полную карту не попадала, и её перебор
    // не ограничивался вовсе.
    const target = from('target@example.invalid', '203.0.113.99')
    for (let attempt = 0; attempt < LOGIN_THROTTLE.maxFailures; attempt += 1) {
      recordFailure(target, NOW + 1)
    }
    expect(checkLogin(target, NOW + 1).blocked).toBe(true)
    expect(trackedCounts().byAccountAndAddress).toBe(LOGIN_THROTTLE.maxTrackedKeys)
  })

  it('неизвестная учётная запись не заблокирована', () => {
    expect(checkLogin(from('nobody@example.invalid'), NOW)).toEqual({
      blocked: false,
      retryAfterSeconds: 0,
    })
  })
})

describe('адрес клиента', () => {
  const headers = (value: string | null) => ({
    get: (name: string) => (name === 'x-forwarded-for' ? value : null),
  })

  it('Caddy присылает один адрес — он и берётся', () => {
    expect(clientAddress(headers('203.0.113.10'))).toBe('203.0.113.10')
    expect(clientAddress(headers(' 2001:DB8::1 '))).toBe('2001:db8::1')
  })

  it('из цепочки берётся последний адрес — его добавил ближайший прокси', () => {
    // Первый задаёт клиент: подставляя каждый раз новый, он обходил бы счётчик.
    expect(clientAddress(headers('1.2.3.4, 203.0.113.10'))).toBe('203.0.113.10')
  })

  it('без заголовка или с мусором в нём — unknown', () => {
    expect(clientAddress(headers(null))).toBe(UNKNOWN_ADDRESS)
    expect(clientAddress(headers(''))).toBe(UNKNOWN_ADDRESS)
    expect(clientAddress(headers('10.0.0.2, '))).toBe(UNKNOWN_ADDRESS)
    expect(clientAddress(headers('x'.repeat(500)))).toBe(UNKNOWN_ADDRESS)
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
        throttledAttempt(from('target@example.invalid'), async () => {
          checked += 1
          return slowWrongPassword()
        }),
      ),
    )
    expect(checked).toBe(LOGIN_THROTTLE.maxFailures)
    expect(attempts.filter((attempt) => attempt.blocked)).toHaveLength(100 - LOGIN_THROTTLE.maxFailures)
  })

  it('сто одновременных догадок по разным учётным записям — не больше предела адреса', async () => {
    let checked = 0
    await Promise.all(
      Array.from({ length: 100 }, (_, index) =>
        throttledAttempt(from(`spray-${index}@example.invalid`), async () => {
          checked += 1
          return slowWrongPassword()
        }),
      ),
    )
    expect(checked).toBe(LOGIN_THROTTLE.maxFailuresPerAddress)
  })

  it('верный пароль с последней разрешённой попытки пускает и обнуляет счётчик', async () => {
    for (let index = 0; index < LOGIN_THROTTLE.maxFailures - 1; index += 1) {
      await throttledAttempt(from('user@example.invalid'), slowWrongPassword)
    }
    const success = await throttledAttempt(from('user@example.invalid'), async () => ({ id: 'u1' }))
    expect(success).toEqual({ blocked: false, result: { id: 'u1' }, triggered: [] })
    expect(checkLogin(from('user@example.invalid')).blocked).toBe(false)
  })
})

describe('снятие блокировки с учётной записи', () => {
  beforeEach(() => resetThrottle())

  it('администратор выдал новый пароль — вход с любого адреса снова открыт', () => {
    const first = from('victim@skilllink.demo', '203.0.113.1')
    const second = from('victim@skilllink.demo', '203.0.113.2')
    for (let index = 0; index < LOGIN_THROTTLE.maxFailures; index += 1) {
      recordFailure(first, NOW)
      recordFailure(second, NOW)
    }
    expect(checkLogin(first, NOW).blocked).toBe(true)
    expect(checkLogin(second, NOW).blocked).toBe(true)

    releaseAccount('victim@skilllink.demo')

    expect(checkLogin(first, NOW).blocked).toBe(false)
    expect(checkLogin(second, NOW).blocked).toBe(false)
  })

  it('чужие учётные записи и счётчики адресов не трогаются', () => {
    const other = from('other@skilllink.demo', '203.0.113.1')
    for (let index = 0; index < LOGIN_THROTTLE.maxFailures; index += 1) recordFailure(other, NOW)
    const before = trackedCounts()

    releaseAccount('victim@skilllink.demo')

    expect(checkLogin(other, NOW).blocked).toBe(true)
    expect(trackedCounts().byAddress).toBe(before.byAddress)
  })
})

describe('когда нужна проверка «не робот»', () => {
  beforeEach(() => resetThrottle())

  it('после нескольких неудач по учётной записи с одного адреса — и не раньше', () => {
    const source = from('captcha@example.ru')
    for (let failure = 0; failure < LOGIN_CAPTCHA.afterFailures; failure += 1) {
      expect(needsCaptcha(source, NOW)).toBe(false)
      recordFailure(source, NOW)
    }
    expect(needsCaptcha(source, NOW)).toBe(true)
    // Раньше, чем закрывается вход: иначе проверку никто бы не увидел.
    expect(checkLogin(source, NOW).blocked).toBe(false)
  })

  it('опечатки соседей по адресу её не включают', () => {
    for (let index = 0; index < LOGIN_CAPTCHA.afterFailures * 3; index += 1) {
      recordFailure(from(`neighbour-${index}@example.ru`), NOW)
    }
    expect(needsCaptcha(from('me@example.ru'), NOW)).toBe(false)
  })

  it('перебор одной учётной записи с многих адресов включает её для всех', () => {
    for (let index = 0; index < LOGIN_CAPTCHA.afterFailuresPerAccount; index += 1) {
      recordFailure(from('target@example.ru', `198.51.100.${index}`), NOW)
    }
    expect(needsCaptcha(from('target@example.ru', '203.0.113.99'), NOW)).toBe(true)
  })

  it('удачный вход снимает её', () => {
    const source = from('captcha@example.ru')
    for (let failure = 0; failure < LOGIN_CAPTCHA.afterFailures; failure += 1) recordFailure(source, NOW)
    recordSuccess(source, NOW)
    expect(needsCaptcha(source, NOW)).toBe(false)
  })

  it('после окна неудачи забываются', () => {
    const source = from('captcha@example.ru')
    for (let failure = 0; failure < LOGIN_CAPTCHA.afterFailures; failure += 1) recordFailure(source, NOW)
    expect(needsCaptcha(source, NOW + LOGIN_THROTTLE.windowMs + 1)).toBe(false)
  })
})
