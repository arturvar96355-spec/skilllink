import { describe, expect, it } from 'vitest'
import { RATE_LIMIT_WINDOW_MS } from '@/shared/config/rate-limit.config'
import {
  RateLimitStore,
  calendarFeedToken,
  clientAddressFromHeaders,
  evaluate,
  normalizeAddress,
  rateLimitGroup,
  rateLimitHeaders,
  UNKNOWN_CLIENT,
} from './rate-limit'

const W = RATE_LIMIT_WINDOW_MS
/** Начало какой-то минуты: от него удобно отсчитывать доли окна. */
const T0 = 1_000 * W

function fill(store: RateLimitStore, key: string, limit: number, count: number, now: number): void {
  for (let index = 0; index < count; index += 1) store.consume(key, limit, now)
}

describe('скользящее окно из двух корзин', () => {
  it('пропускает ровно limit запросов в пустом окне, следующий — 429', () => {
    const store = new RateLimitStore()
    const decisions = Array.from({ length: 6 }, () => store.consume('k', 5, T0 + 1_000))
    expect(decisions.map((decision) => decision.allowed)).toEqual([true, true, true, true, true, false])
    expect(decisions.map((decision) => decision.remaining)).toEqual([4, 3, 2, 1, 0, 0])
  })

  it('отклонённые запросы не засчитываются: после спада проходит столько, сколько освободилось', () => {
    const store = new RateLimitStore()
    fill(store, 'k', 10, 10, T0 + 1_000)
    // Сто отказов подряд ничего не добавляют к счёту.
    for (let index = 0; index < 100; index += 1) expect(store.consume('k', 10, T0 + 2_000).allowed).toBe(false)
    // Через полминуты следующей минуты прошлая весит половину: 10 × 0,5 = 5.
    const later = T0 + W + W / 2
    const allowed = Array.from({ length: 10 }, () => store.consume('k', 10, later).allowed)
    expect(allowed.filter(Boolean)).toHaveLength(5)
  })

  it('на стыке минут прошлая корзина не обнуляется: удвоенного предела нет', () => {
    const store = new RateLimitStore()
    fill(store, 'k', 10, 10, T0 + W - 1)
    // Первая миллисекунда новой минуты: прошлая весит почти целиком.
    expect(store.consume('k', 10, T0 + W + 1).allowed).toBe(false)
  })

  it('спад: вес прошлой минуты убывает линейно', () => {
    const store = new RateLimitStore()
    fill(store, 'k', 100, 100, T0 + 10)
    // Через 90 % следующей минуты прошлая весит 10 — свободно 90.
    const later = T0 + W + 0.9 * W
    const allowed = Array.from({ length: 100 }, () => store.consume('k', 100, later).allowed)
    expect(allowed.filter(Boolean).length).toBe(90)
  })

  it('давние счётчики забываются: через две минуты окно пустое', () => {
    const store = new RateLimitStore()
    fill(store, 'k', 3, 3, T0)
    expect(store.consume('k', 3, T0 + 2 * W).remaining).toBe(2)
  })

  it('ключи считаются независимо', () => {
    const store = new RateLimitStore()
    fill(store, 'a', 2, 2, T0)
    expect(store.consume('a', 2, T0).allowed).toBe(false)
    expect(store.consume('b', 2, T0).allowed).toBe(true)
  })
})

describe('Retry-After', () => {
  it('переполнена текущая минута — ждать до спада в следующей', () => {
    // 10 из 10 в начале минуты: следующий пройдёт, когда 10 × (1 − t) ≤ 9, то есть
    // через 10 % следующей минуты — 60 − 1 + 6 = 65 с, ограничено шестьюдесятью.
    const { decision } = evaluate({ index: T0 / W, current: 10, previous: 0, reportedIndex: -1 }, 10, T0 + 1_000)
    expect(decision.allowed).toBe(false)
    expect(decision.retryAfterSeconds).toBe(60)
  })

  it('перегружает прошлая минута — ждать, пока её вес упадёт', () => {
    // Середина минуты: 0 + 20 × 0,5 = 10 при пределе 10. Нужно ≤ 9: 20 × (0,5 − t) ≤ 9 → t = 0,05 окна = 3 с.
    const { decision } = evaluate({ index: T0 / W, current: 0, previous: 20, reportedIndex: -1 }, 10, T0 + W / 2)
    expect(decision.allowed).toBe(false)
    expect(decision.retryAfterSeconds).toBe(3)
    expect(decision.resetSeconds).toBe(3)
  })

  it('через указанное время запрос действительно проходит, а на секунду раньше — нет', () => {
    const store = new RateLimitStore()
    fill(store, 'k', 10, 10, T0 + 20_000)
    const rejected = store.consume('k', 10, T0 + 30_000)
    expect(rejected.allowed).toBe(false)
    const retryAt = T0 + 30_000 + rejected.retryAfterSeconds * 1000
    expect(store.consume('k', 10, retryAt - 2_000).allowed).toBe(false)
    expect(store.consume('k', 10, retryAt).allowed).toBe(true)
  })

  it('никогда не меньше секунды и не больше минуты', () => {
    for (const [current, previous, at] of [
      [1, 0, 0.999],
      [50, 50, 0.01],
      [0, 11, 0.9999],
    ] as const) {
      const { decision } = evaluate({ index: T0 / W, current, previous, reportedIndex: -1 }, 1, T0 + at * W)
      expect(decision.retryAfterSeconds).toBeGreaterThanOrEqual(1)
      expect(decision.retryAfterSeconds).toBeLessThanOrEqual(60)
    }
  })

  it('первый отказ в минуте помечен для журнала, следующие — нет, в новой минуте — снова', () => {
    const store = new RateLimitStore()
    fill(store, 'k', 1, 1, T0)
    expect(store.consume('k', 1, T0 + 1).firstRejection).toBe(true)
    expect(store.consume('k', 1, T0 + 2).firstRejection).toBe(false)
    expect(store.consume('k', 1, T0 + W + 1).firstRejection).toBe(true)
  })
})

describe('хранилище в памяти', () => {
  it('не растёт больше предела: давние записи вытесняются', () => {
    const store = new RateLimitStore(100, 10)
    for (let index = 0; index < 1_000; index += 1) store.consume(`k${index}`, 5, T0)
    expect(store.size).toBe(100)
  })

  it('записи старше прошлой минуты вычищаются по ходу запросов', () => {
    const store = new RateLimitStore(10_000, 50)
    for (let index = 0; index < 40; index += 1) store.consume(`old${index}`, 5, T0)
    store.consume('fresh', 5, T0 + 3 * W)
    expect(store.size).toBe(1)
  })

  it('живые записи чистка не трогает', () => {
    const store = new RateLimitStore(10_000, 50)
    fill(store, 'live', 5, 5, T0)
    store.consume('other', 5, T0 + W + 1)
    expect(store.consume('live', 5, T0 + W + 2).allowed).toBe(false)
  })
})

describe('группы маршрутов', () => {
  it('проверка живости и вебхук Telegram не ограничиваются', () => {
    expect(rateLimitGroup('GET', '/api/health')).toBeNull()
    expect(rateLimitGroup('GET', '/api/health/')).toBeNull()
    expect(rateLimitGroup('POST', '/api/telegram/webhook')).toBeNull()
  })

  it('вход и задача «не робот» — группа входа; чтение сессии — обычное чтение', () => {
    expect(rateLimitGroup('GET', '/api/login-challenge')).toBe('auth')
    expect(rateLimitGroup('POST', '/api/auth/callback/credentials')).toBe('auth')
    expect(rateLimitGroup('POST', '/api/auth/signout')).toBe('auth')
    expect(rateLimitGroup('GET', '/api/auth/session')).toBe('read')
    expect(rateLimitGroup('GET', '/api/auth/csrf')).toBe('read')
  })

  it('лента календаря — своя группа', () => {
    expect(rateLimitGroup('GET', '/api/calendar/abc.ics')).toBe('feed')
    // Управление своей ссылкой — обычные чтение и запись.
    expect(rateLimitGroup('GET', '/api/me/calendar')).toBe('read')
    expect(rateLimitGroup('POST', '/api/me/calendar')).toBe('write')
  })

  it('выгрузки, загрузки, пакеты документов, генерация и ИИ — тяжёлые', () => {
    expect(rateLimitGroup('GET', '/api/export')).toBe('heavy')
    expect(rateLimitGroup('POST', '/api/import')).toBe('heavy')
    expect(rateLimitGroup('POST', '/api/cooperations/c1/documents/generate')).toBe('heavy')
    expect(rateLimitGroup('POST', '/api/recommendations/generate')).toBe('heavy')
    expect(rateLimitGroup('POST', '/api/data-sources/sync')).toBe('heavy')
    expect(rateLimitGroup('POST', '/api/cooperations/c1/ai-summary')).toBe('heavy')
    expect(rateLimitGroup('POST', '/api/recommendations/r1/ai-letter')).toBe('heavy')
    expect(rateLimitGroup('GET', '/api/universities/u1/contacts/c1/dsar')).toBe('heavy')
  })

  it('остальное: GET — чтение, изменения — запись', () => {
    expect(rateLimitGroup('GET', '/api/universities')).toBe('read')
    expect(rateLimitGroup('HEAD', '/api/universities')).toBe('read')
    expect(rateLimitGroup('POST', '/api/universities')).toBe('write')
    expect(rateLimitGroup('PATCH', '/api/workflow/stages/s1')).toBe('write')
    expect(rateLimitGroup('delete', '/api/skills/s1')).toBe('write')
    // Похожее имя — не выгрузка.
    expect(rateLimitGroup('GET', '/api/exporter')).toBe('read')
  })

  it('токен ленты берётся из пути', () => {
    expect(calendarFeedToken('/api/calendar/abc-DEF_1.ics')).toBe('abc-DEF_1.ics')
    expect(calendarFeedToken('/api/calendar/')).toBeNull()
    expect(calendarFeedToken('/api/me/calendar')).toBeNull()
  })
})

describe('адрес клиента', () => {
  it('IPv4 — целиком', () => {
    expect(normalizeAddress('203.0.113.7')).toBe('203.0.113.7')
    expect(normalizeAddress(' 203.0.113.7 ')).toBe('203.0.113.7')
  })

  it('IPv4, отображённый в IPv6, — тот же IPv4', () => {
    expect(normalizeAddress('::ffff:203.0.113.7')).toBe('203.0.113.7')
    expect(normalizeAddress('::FFFF:cb00:7107')).toBe('203.0.113.7')
    expect(normalizeAddress('[::ffff:203.0.113.7]')).toBe('203.0.113.7')
  })

  it('IPv6 сворачивается до /48: смена адреса внутри подсети счётчик не меняет', () => {
    const a = normalizeAddress('2001:db8:abcd:1::1')
    const b = normalizeAddress('2001:0db8:abcd:ffff:1234:5678:9abc:def0')
    const c = normalizeAddress('2001:db8:abcd::')
    expect(a).toBe('2001:db8:abcd::/48')
    expect(b).toBe(a)
    expect(c).toBe(a)
    expect(normalizeAddress('2001:db8:abce::1')).not.toBe(a)
    expect(normalizeAddress('fe80::1%eth0')).toBe('fe80:0:0::/48')
  })

  it('мусор — один общий «неизвестный» адрес', () => {
    for (const raw of ['', null, undefined, 'unknown', '256.1.1.1', '1.2.3', 'a::b::c', '1:2:3:4:5:6:7:8:9', 'x'.repeat(100)]) {
      expect(normalizeAddress(raw)).toBe(UNKNOWN_CLIENT)
    }
  })

  it('берётся последний адрес X-Forwarded-For: подделанный первый не действует', () => {
    const headers = new Headers({ 'x-forwarded-for': '1.1.1.1, 10.0.0.1, 198.51.100.4' })
    expect(clientAddressFromHeaders(headers)).toBe('198.51.100.4')

    // Клиент подставляет разные «свои» адреса — счётчик один.
    const spoofed = ['9.9.9.9', '8.8.8.8', '127.0.0.1'].map((fake) =>
      clientAddressFromHeaders(new Headers({ 'x-forwarded-for': `${fake}, 198.51.100.4` })),
    )
    expect(new Set(spoofed)).toEqual(new Set(['198.51.100.4']))
  })

  it('без заголовка — неизвестный адрес', () => {
    expect(clientAddressFromHeaders(new Headers())).toBe(UNKNOWN_CLIENT)
  })
})

describe('заголовки RateLimit-*', () => {
  it('на принятом — предел, остаток и сдвиг окна, без Retry-After', () => {
    const { decision } = evaluate(undefined, 10, T0 + 15_000)
    expect(rateLimitHeaders(decision)).toEqual({
      'RateLimit-Limit': '10',
      'RateLimit-Remaining': '9',
      'RateLimit-Reset': '45',
    })
  })

  it('на отказе — остаток 0 и Retry-After, равный сдвигу окна', () => {
    const { decision } = evaluate({ index: T0 / W, current: 0, previous: 20, reportedIndex: -1 }, 10, T0 + W / 2)
    expect(rateLimitHeaders(decision)).toEqual({
      'RateLimit-Limit': '10',
      'RateLimit-Remaining': '0',
      'RateLimit-Reset': '3',
      'Retry-After': '3',
    })
  })
})
