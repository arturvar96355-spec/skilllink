import {
  RATE_LIMIT_EXEMPT_PATHS,
  RATE_LIMIT_HEAVY_PATTERNS,
  RATE_LIMIT_STORE,
  RATE_LIMIT_WINDOW_MS,
  type RateLimitGroup,
} from '@/shared/config/rate-limit.config'

/**
 * Общее ограничение частоты запросов к API (решение 117): алгоритм, группы
 * маршрутов и адрес клиента. Здесь нет ни базы, ни сессии, ни Next — только
 * вычисления, поэтому всё проверяется модульными тестами. Подключение к
 * обработчикам маршрутов — rate-limit-guard.ts.
 *
 * **Алгоритм — скользящее окно из двух корзин.** Время делится на минуты,
 * у каждого ключа два счётчика: текущая минута и предыдущая. Оценка числа
 * запросов за последние 60 секунд:
 *
 *     weighted = текущая + предыдущая × (1 − доля прошедшей части текущей минуты)
 *
 * Это не точный журнал запросов, а оценка в предположении, что прошлая минута
 * была равномерной; зато две корзины на ключ вместо списка отметок времени.
 * Простое окно «по минутам» пропускало бы удвоенный предел на стыке минут:
 * полный предел в последнюю секунду одной и в первую секунду следующей.
 *
 * Запрос проходит, если `weighted + 1 ≤ limit`. Отклонённый запрос **не
 * засчитывается**: иначе клиент, продолжающий стучаться, никогда бы не вышел
 * из-под ограничения, а честно подождавший — вышел бы позже, чем сказано
 * в `Retry-After`.
 */

// ── Алгоритм ─────────────────────────────────────────────────────────────────

/** Допуск на двоичное округление при сравнении оценки с пределом. */
const EPSILON = 1e-9

/** Счётчики одного ключа. */
export interface WindowCounters {
  /** Номер текущей минуты: floor(время / окно). */
  index: number
  /** Принятых запросов в текущей минуте. */
  current: number
  /** Принятых запросов в предыдущей минуте. */
  previous: number
  /** Минута, о превышении в которой уже сообщено в журнал. −1 — не сообщалось. */
  reportedIndex: number
}

export interface RateLimitDecision {
  allowed: boolean
  limit: number
  /** Сколько запросов ещё пройдёт прямо сейчас. */
  remaining: number
  /**
   * Через сколько секунд окно сдвинется: для принятого — до конца текущей минуты
   * (её запросы начнут «остывать»), для отклонённого — то же, что `Retry-After`.
   */
  resetSeconds: number
  /** Для отклонённого: через сколько секунд пройдёт следующий запрос (1…60). */
  retryAfterSeconds: number
  /** Отклонён первым в этой минуте для этого ключа — о нём пишется журнал. */
  firstRejection: boolean
}

/** Счётчики, приведённые к минуте `index`: прошлая минута становится предыдущей, давняя — забывается. */
export function rollCounters(counters: WindowCounters | undefined, index: number): WindowCounters {
  if (counters === undefined) return { index, current: 0, previous: 0, reportedIndex: -1 }
  // Часы могут шагнуть назад (синхронизация времени) — тогда считаем минуту той же.
  if (counters.index >= index) return counters
  const previous = counters.index === index - 1 ? counters.current : 0
  return { index, current: 0, previous, reportedIndex: counters.reportedIndex }
}

/** Оценка числа запросов за последнее окно. */
export function weightedCount(counters: WindowCounters, elapsedFraction: number): number {
  return counters.current + counters.previous * (1 - elapsedFraction)
}

/**
 * Через сколько миллисекунд оценка опустится до `limit − 1` — тогда пройдёт
 * ещё один запрос, — если новых принятых запросов не будет.
 *
 * Пока идёт текущая минута, оценка убывает за счёт предыдущей корзины. Если
 * одной текущей уже хватает на отказ, ждать приходится следующей минуты,
 * где текущая станет предыдущей и начнёт убывать сама.
 */
export function msUntilAllowed(counters: WindowCounters, elapsedFraction: number, limit: number): number {
  const target = limit - 1
  const window = RATE_LIMIT_WINDOW_MS
  const leftInWindow = (1 - elapsedFraction) * window
  const weighted = weightedCount(counters, elapsedFraction)
  if (weighted <= target + EPSILON) return 0

  if (counters.current <= target && counters.previous > 0) {
    return ((weighted - target) * window) / counters.previous
  }
  // Следующая минута: оценка = current × (1 − t/окно).
  return leftInWindow + (1 - Math.max(target, 0) / counters.current) * window
}

const clampSeconds = (ms: number, max: number): number => Math.min(max, Math.max(1, Math.ceil(ms / 1000)))

/**
 * Попытка одного запроса. Возвращает новые счётчики (их сохраняет хранилище)
 * и решение. Чистая функция: время передаётся явно.
 */
export function evaluate(
  before: WindowCounters | undefined,
  limit: number,
  now: number,
): { counters: WindowCounters; decision: RateLimitDecision } {
  const window = RATE_LIMIT_WINDOW_MS
  const index = Math.floor(now / window)
  const elapsedFraction = (now - index * window) / window
  const counters = rollCounters(before, index)
  const weighted = weightedCount(counters, elapsedFraction)
  const windowResetSeconds = clampSeconds((1 - elapsedFraction) * window, window / 1000)

  // Допуск на округление: 10 × 0,9 в двоичной арифметике — чуть больше 9, и запрос
  // в ту самую секунду, что названа в Retry-After, получил бы отказ.
  if (weighted + 1 > limit + EPSILON) {
    const retryAfterSeconds = clampSeconds(msUntilAllowed(counters, elapsedFraction, limit), 60)
    const firstRejection = counters.reportedIndex !== index
    return {
      counters: { ...counters, reportedIndex: index },
      decision: {
        allowed: false,
        limit,
        remaining: 0,
        resetSeconds: retryAfterSeconds,
        retryAfterSeconds,
        firstRejection,
      },
    }
  }

  const next = { ...counters, current: counters.current + 1 }
  return {
    counters: next,
    decision: {
      allowed: true,
      limit,
      remaining: Math.max(0, Math.floor(limit - (weighted + 1))),
      resetSeconds: windowResetSeconds,
      retryAfterSeconds: 0,
      firstRejection: false,
    },
  }
}

// ── Хранилище в памяти процесса ──────────────────────────────────────────────

/**
 * Карта «ключ → счётчики» с пределом размера и постепенной чисткой.
 *
 * Порядок записей в Map — порядок последнего обращения: запись при каждом
 * обращении переставляется в конец. Значит, в начале карты — самые давние,
 * и чистка смотрит только туда: за каждый запрос — до `sweepBatch` записей
 * с начала, пока не встретится живая. Записи старше предыдущей минуты уже
 * ничего не ограничивают и удаляются. Отдельного таймера нет: нет запросов —
 * нечего и чистить.
 *
 * Если карта всё равно полна (перебор по множеству адресов), вытесняется самая
 * давняя запись. Отказывать новой записи нельзя: тогда после 50 000 случайных
 * адресов каждый новый клиент получал бы 429.
 */
export class RateLimitStore {
  private readonly entries = new Map<string, WindowCounters>()

  constructor(
    private readonly maxKeys: number = RATE_LIMIT_STORE.maxTrackedKeys,
    private readonly sweepBatch: number = RATE_LIMIT_STORE.sweepBatch,
  ) {}

  consume(key: string, limit: number, now: number = Date.now()): RateLimitDecision {
    const { counters, decision } = evaluate(this.entries.get(key), limit, now)
    this.entries.delete(key)
    this.sweep(counters.index)
    while (this.entries.size >= this.maxKeys) {
      const oldest = this.entries.keys().next().value
      if (oldest === undefined) break
      this.entries.delete(oldest)
    }
    this.entries.set(key, counters)
    return decision
  }

  get size(): number {
    return this.entries.size
  }

  clear(): void {
    this.entries.clear()
  }

  /** Убирает с начала карты записи, которые уже ничего не ограничивают. */
  private sweep(index: number): void {
    let looked = 0
    for (const [key, counters] of this.entries) {
      if (looked >= this.sweepBatch || counters.index >= index - 1) break
      this.entries.delete(key)
      looked += 1
    }
  }
}

// ── Группы маршрутов ─────────────────────────────────────────────────────────

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * Группа предела для запроса. `null` — маршрут не ограничивается.
 * Путь — без строки запроса.
 */
export function rateLimitGroup(method: string, pathname: string): RateLimitGroup | null {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
  if (RATE_LIMIT_EXEMPT_PATHS.includes(path)) return null
  const upper = method.toUpperCase()

  if (path === '/api/login-challenge') return 'auth'
  // Вход, выход и обмен токеном NextAuth. Чтение сессии и csrf-токена — обычное чтение.
  if (path.startsWith('/api/auth/') && !SAFE_METHODS.has(upper)) return 'auth'
  if (path.startsWith('/api/calendar/')) return 'feed'
  if (RATE_LIMIT_HEAVY_PATTERNS.some((pattern) => pattern.test(path))) return 'heavy'
  return SAFE_METHODS.has(upper) ? 'read' : 'write'
}

/** Токен ленты календаря из пути `/api/calendar/<токен>.ics`; `null` — пути без токена. */
export function calendarFeedToken(pathname: string): string | null {
  const match = /^\/api\/calendar\/([^/]+)\/?$/.exec(pathname)
  return match?.[1] ?? null
}

// ── Адрес клиента ────────────────────────────────────────────────────────────

/** Адрес не определён или не похож на адрес: все такие запросы — один субъект. */
export const UNKNOWN_CLIENT = 'unknown'

/** Длиннее адрес IPv6 с зоной не бывает; остальное — мусор в заголовке. */
const MAX_ADDRESS_LENGTH = 64

function parseIpv4(text: string): number[] | null {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text)
  if (!match) return null
  const octets = match.slice(1).map(Number)
  return octets.every((octet) => octet <= 255) ? octets : null
}

/** Восемь групп адреса IPv6 или `null`. Понимает `::` и IPv4 в хвосте (`::ffff:1.2.3.4`). */
function parseIpv6(text: string): number[] | null {
  if (!text.includes(':')) return null
  const halves = text.split('::')
  if (halves.length > 2) return null

  const parseSide = (side: string): number[] | null => {
    if (side === '') return []
    const groups: number[] = []
    const parts = side.split(':')
    for (const [position, part] of parts.entries()) {
      // IPv4 допустим только последней частью адреса.
      if (part.includes('.') && position === parts.length - 1) {
        const v4 = parseIpv4(part)
        if (!v4) return null
        groups.push(((v4[0]! << 8) | v4[1]!) >>> 0, ((v4[2]! << 8) | v4[3]!) >>> 0)
        continue
      }
      if (!/^[0-9a-f]{1,4}$/i.test(part)) return null
      groups.push(parseInt(part, 16))
    }
    return groups
  }

  const head = parseSide(halves[0]!)
  const tail = halves.length === 2 ? parseSide(halves[1]!) : []
  if (head === null || tail === null) return null
  if (halves.length === 1) return head.length === 8 ? head : null
  const missing = 8 - head.length - tail.length
  if (missing < 1) return null
  return [...head, ...new Array<number>(missing).fill(0), ...tail]
}

/**
 * Адрес клиента в виде ключа ограничения.
 *
 * - IPv4 — целиком, в каноническом виде;
 * - IPv4, отображённый в IPv6 (`::ffff:1.2.3.4`), — как IPv4: это один и тот же клиент;
 * - IPv6 — сеть /48. Провайдер выдаёт абоненту целую подсеть /64 и шире,
 *   и адрес внутри неё клиент меняет сам, без ограничений. Считать по полному
 *   адресу — значит дать каждому 2^64 независимых счётчика. /48 — типичный
 *   размер выдачи организации: по нему обход стоит отдельной сети.
 */
export function normalizeAddress(raw: string | null | undefined): string {
  let text = (raw ?? '').trim().toLowerCase()
  if (text === '' || text.length > MAX_ADDRESS_LENGTH) return UNKNOWN_CLIENT
  if (text.startsWith('[') && text.endsWith(']')) text = text.slice(1, -1)
  // Зона (fe80::1%eth0) к адресу клиента отношения не имеет.
  text = text.replace(/%.*$/, '')

  const v4 = parseIpv4(text)
  if (v4) return v4.join('.')

  const v6 = parseIpv6(text)
  if (!v6) return UNKNOWN_CLIENT
  const mapped = v6.slice(0, 5).every((group) => group === 0) && v6[5] === 0xffff
  if (mapped) {
    return [v6[6]! >> 8, v6[6]! & 0xff, v6[7]! >> 8, v6[7]! & 0xff].join('.')
  }
  return `${v6
    .slice(0, 3)
    .map((group) => group.toString(16))
    .join(':')}::/48`
}

/**
 * Адрес клиента — **последний** в `X-Forwarded-For`.
 *
 * Перед приложением стоит Caddy (deploy/yandex-cloud/Caddyfile). Доверенных
 * прокси перед ним нет, поэтому присланный клиентом заголовок Caddy отбрасывает
 * и выставляет свой — с адресом соединения. Последний адрес в цепочке всегда
 * дописывает ближайший к приложению прокси, а первые задаёт кто угодно:
 * взять первый — значит дать клиенту выбирать себе счётчик. Без прокси
 * (`next start` локально) Next сам подставляет адрес соединения.
 */
export function clientAddressFromHeaders(headers: { get(name: string): string | null }): string {
  const last = headers.get('x-forwarded-for')?.split(',').at(-1)
  return normalizeAddress(last)
}

// ── Заголовки ответа ─────────────────────────────────────────────────────────

/**
 * Заголовки `RateLimit-*` по черновику IETF «RateLimit header fields for HTTP»:
 * предел за окно, сколько осталось, через сколько секунд окно сдвинется.
 * На отказе — ещё `Retry-After` (RFC 9110).
 */
export function rateLimitHeaders(decision: RateLimitDecision): Record<string, string> {
  return {
    'RateLimit-Limit': String(decision.limit),
    'RateLimit-Remaining': String(decision.remaining),
    'RateLimit-Reset': String(decision.resetSeconds),
    ...(decision.allowed ? {} : { 'Retry-After': String(decision.retryAfterSeconds) }),
  }
}
