import { LOGIN_CAPTCHA, LOGIN_THROTTLE } from '@/shared/config/auth.config'

/**
 * Ограничение перебора пароля.
 *
 * Три счётчика, и попытка проходит, только если свободны все:
 *
 * - **учётная запись + адрес клиента** — не дать подобрать пароль к конкретному
 *   пользователю. Счёт ведётся не по одной учётной записи: иначе любой посторонний
 *   пятью неверными паролями закрыл бы вход владельцу, где бы тот ни был, — демо-вход
 *   менеджера на показе закрывался бы с любого ноутбука в зале;
 * - **адрес клиента** — не дать перебирать один пароль по многим учётным записям
 *   с одного адреса. Предел выше: за одним адресом бывает целая аудитория;
 * - **учётная запись со всех адресов** — общий потолок за час, чтобы перебор
 *   с множества адресов не был бесконечным. Он высокий: закрыть им вход владельцу
 *   может только тот, у кого много адресов.
 *
 * Состояние живёт в памяти процесса. При нескольких экземплярах приложения у каждого
 * будет свой счётчик, а перезапуск его обнуляет — ограничение честно описано
 * в docs/SECURITY_LIMITATIONS.md. Хранилище (Redis или таблица) — отдельная задача.
 */

/** Предел одного счётчика. */
export interface ThrottleLimits {
  maxFailures: number
  /** Окно, в котором неудачи складываются, мс. */
  windowMs: number
  /** На сколько закрывается вход после исчерпания, мс. */
  blockMs: number
}

const PAIR_LIMITS: ThrottleLimits = {
  maxFailures: LOGIN_THROTTLE.maxFailures,
  windowMs: LOGIN_THROTTLE.windowMs,
  blockMs: LOGIN_THROTTLE.blockMs,
}
const ADDRESS_LIMITS: ThrottleLimits = { ...PAIR_LIMITS, maxFailures: LOGIN_THROTTLE.maxFailuresPerAddress }
const ACCOUNT_LIMITS: ThrottleLimits = {
  maxFailures: LOGIN_THROTTLE.maxFailuresPerAccount,
  windowMs: LOGIN_THROTTLE.accountWindowMs,
  blockMs: LOGIN_THROTTLE.blockMs,
}

export interface ThrottleState {
  failures: number
  /** Время первой неудачи в текущем окне. */
  windowStartedAt: number
  /** До какого момента вход закрыт. null — не закрыт. */
  blockedUntil: number | null
}

/** Откуда и под кем пытаются войти. */
export interface LoginSource {
  /** Введённый адрес электронной почты в нижнем регистре — есть он в базе или нет. */
  account: string
  /** Адрес клиента (clientAddress). */
  address: string
}

/** Адрес клиента не определён: все такие попытки считаются одним адресом. */
export const UNKNOWN_ADDRESS = 'unknown'

/** Длиннее адрес IPv6 не бывает; всё, что длиннее, — не адрес, а мусор в заголовке. */
const MAX_ADDRESS_LENGTH = 64

/**
 * Адрес клиента — последний в `X-Forwarded-For`.
 *
 * Перед приложением стоит Caddy (deploy/yandex-cloud/Caddyfile). Присланному
 * клиентом заголовку он не доверяет и выставляет свой — с одним адресом, тем,
 * с которого пришло соединение. Берётся последний адрес, а не первый: его всегда
 * дописывает ближайший прокси, а первый при доверенной цепочке прокси задаёт
 * клиент — и подставлял бы любой, обходя счётчик. Без прокси Next подставляет
 * адрес соединения, если заголовка нет; подделать его можно только там, где
 * к приложению ходят напрямую, — на стенде порт 3000 наружу закрыт.
 */
export function clientAddress(headers: { get(name: string): string | null }): string {
  const last = headers.get('x-forwarded-for')?.split(',').at(-1)?.trim() ?? ''
  if (last === '' || last.length > MAX_ADDRESS_LENGTH) return UNKNOWN_ADDRESS
  return last.toLowerCase()
}

export function isBlocked(state: ThrottleState | undefined, now: number): boolean {
  return state?.blockedUntil !== null && state?.blockedUntil !== undefined && state.blockedUntil > now
}

/**
 * Регистрирует неудачную попытку и возвращает новое состояние.
 *
 * Окно скользит: если предыдущая неудача была давно, счёт начинается заново —
 * иначе редкие опечатки за месяц накопились бы в блокировку.
 */
export function registerFailure(
  state: ThrottleState | undefined,
  now: number,
  limits: ThrottleLimits = PAIR_LIMITS,
): ThrottleState {
  if (isBlocked(state, now)) return state as ThrottleState

  const withinWindow = state !== undefined && now - state.windowStartedAt <= limits.windowMs

  const failures = withinWindow ? state.failures + 1 : 1
  const windowStartedAt = withinWindow ? state.windowStartedAt : now

  return {
    failures,
    windowStartedAt,
    blockedUntil: failures >= limits.maxFailures ? now + limits.blockMs : null,
  }
}

/**
 * Снимает одну неудачу — удачный вход не должен расходовать попытки адреса.
 *
 * Неудача записывается до проверки пароля (throttledAttempt), поэтому удачный
 * вход тоже её оставил. Обнулять счётчик адреса целиком нельзя: тогда своя
 * учётная запись позволяла бы перебирать чужие без предела, входя в неё
 * между догадками.
 */
export function forgiveFailure(
  state: ThrottleState | undefined,
  maxFailures: number,
): ThrottleState | undefined {
  if (state === undefined) return undefined
  const failures = Math.max(0, state.failures - 1)
  return { ...state, failures, blockedUntil: failures >= maxFailures ? state.blockedUntil : null }
}

/** Сколько секунд осталось до снятия блокировки. Для сообщения и журнала. */
export function secondsUntilUnblocked(state: ThrottleState | undefined, now: number): number {
  if (!isBlocked(state, now)) return 0
  return Math.ceil(((state as ThrottleState).blockedUntil! - now) / 1000)
}

// ── Хранилище в памяти процесса ──────────────────────────────────────────────

/**
 * Карта «ключ → состояние» с пределом размера.
 *
 * Порядок записей в Map — порядок последнего изменения: изменённая запись
 * переставляется в конец. При переполнении сначала убираются записи, которые уже
 * ничего не ограничивают, а если их не хватило — самые давно не менявшиеся.
 * Отказать новой записи нельзя: после десяти тысяч случайных адресов перебор
 * по любой новой учётной записи не считался бы вовсе.
 */
class ThrottleStore {
  private readonly states = new Map<string, ThrottleState>()

  constructor(private readonly limits: ThrottleLimits) {}

  get(key: string): ThrottleState | undefined {
    return this.states.get(key)
  }

  /** Возвращает true, если именно эта неудача закрыла вход. */
  fail(key: string, now: number): boolean {
    const before = this.states.get(key)
    const next = registerFailure(before, now, this.limits)
    this.put(key, next, now)
    return !isBlocked(before, now) && isBlocked(next, now)
  }

  forgive(key: string, now: number): void {
    const next = forgiveFailure(this.states.get(key), this.limits.maxFailures)
    if (next) this.put(key, next, now)
  }

  forget(key: string): void {
    this.states.delete(key)
  }

  /** Копия списка ключей: по ней можно удалять, не ломая обход. */
  keys(): string[] {
    return [...this.states.keys()]
  }

  clear(): void {
    this.states.clear()
  }

  get size(): number {
    return this.states.size
  }

  private put(key: string, state: ThrottleState, now: number): void {
    this.states.delete(key)
    if (this.states.size >= LOGIN_THROTTLE.maxTrackedKeys) this.prune(now)
    while (this.states.size >= LOGIN_THROTTLE.maxTrackedKeys) {
      const oldest = this.states.keys().next().value
      if (oldest === undefined) break
      this.states.delete(oldest)
    }
    this.states.set(key, state)
  }

  /** Убирает записи, которые уже ничего не ограничивают. */
  private prune(now: number): void {
    for (const [key, state] of this.states) {
      const expired = !isBlocked(state, now) && now - state.windowStartedAt > this.limits.windowMs
      if (expired) this.states.delete(key)
    }
  }
}

const byAccountAndAddress = new ThrottleStore(PAIR_LIMITS)
const byAddress = new ThrottleStore(ADDRESS_LIMITS)
const byAccount = new ThrottleStore(ACCOUNT_LIMITS)

/** Перевод строки в заголовке запроса невозможен — разделитель не встретится в адресе. */
const pairKey = (source: LoginSource): string => `${source.address}\n${source.account}`

export function checkLogin(
  source: LoginSource,
  now = Date.now(),
): { blocked: boolean; retryAfterSeconds: number } {
  const states = [
    byAccountAndAddress.get(pairKey(source)),
    byAddress.get(source.address),
    byAccount.get(source.account),
  ]
  return {
    blocked: states.some((state) => isBlocked(state, now)),
    retryAfterSeconds: Math.max(...states.map((state) => secondsUntilUnblocked(state, now))),
  }
}

/** Сколько неудач в текущем окне: окно прошло — ноль, как и при следующей неудаче. */
function failuresInWindow(state: ThrottleState | undefined, now: number, windowMs: number): number {
  if (state === undefined || now - state.windowStartedAt > windowMs) return 0
  return state.failures
}

/**
 * Нужна ли перед этой попыткой проверка «не робот» (captcha.ts, решение 100).
 *
 * Да — после нескольких неудач подряд по этой учётной записи с этого адреса или
 * после многих неудач по ней со всех адресов. Счётчик одного адреса по всем
 * учётным записям её не включает: за одним адресом бывает целая аудитория.
 * Удачный вход обнуляет оба счётчика (recordSuccess) — дальше снова без проверки.
 */
export function needsCaptcha(source: LoginSource, now = Date.now()): boolean {
  const pair = failuresInWindow(byAccountAndAddress.get(pairKey(source)), now, PAIR_LIMITS.windowMs)
  const account = failuresInWindow(byAccount.get(source.account), now, ACCOUNT_LIMITS.windowMs)
  return pair >= LOGIN_CAPTCHA.afterFailures || account >= LOGIN_CAPTCHA.afterFailuresPerAccount
}

/** Какой счётчик закрыл вход этой неудачей — для журнала действий. */
export type ThrottleTrigger = 'account-address' | 'address' | 'account'

/**
 * Записывает неудачу во все счётчики. Возвращает, какие из них закрылись именно
 * сейчас: о блокировке журнал узнаёт один раз, а не на каждую отбитую попытку.
 */
export function recordFailure(source: LoginSource, now = Date.now()): ThrottleTrigger[] {
  const triggered: ThrottleTrigger[] = []
  if (byAccountAndAddress.fail(pairKey(source), now)) triggered.push('account-address')
  if (byAddress.fail(source.address, now)) triggered.push('address')
  if (byAccount.fail(source.account, now)) triggered.push('account')
  return triggered
}

/**
 * Удачный вход: счётчики учётной записи обнуляются, с адреса снимается одна неудача
 * (forgiveFailure) — та, что записана до проверки пароля.
 */
export function recordSuccess(source: LoginSource, now = Date.now()): void {
  byAccountAndAddress.forget(pairKey(source))
  byAccount.forget(source.account)
  byAddress.forgive(source.address, now)
}

/**
 * Попытка входа под ограничением перебора.
 *
 * Неудача засчитывается до проверки пароля, а не после: иначе между проверкой
 * блокировки и записью неудачи идут запрос к базе и bcrypt — около 50 мс,
 * и тысяча параллельных запросов даёт тысячу догадок за окно вместо пяти.
 * Проверка и запись идут подряд, без `await` между ними, а удачный вход счётчик
 * учётной записи обнуляет — поэтому верный пароль с пятой попытки пускает.
 *
 * `attempt` возвращает пользователя или `null`, если данные не подошли.
 */
export async function throttledAttempt<T>(
  source: LoginSource,
  attempt: () => Promise<T | null>,
): Promise<
  { blocked: true } | { blocked: false; result: T | null; triggered: ThrottleTrigger[] }
> {
  if (checkLogin(source).blocked) return { blocked: true }
  const triggered = recordFailure(source)

  const result = await attempt()
  if (result !== null) {
    recordSuccess(source)
    // Верный пароль с последней попытки пускает: блокировка, поставленная
    // его же предварительной неудачей, снята, и сообщать о ней нечего.
    return { blocked: false, result, triggered: [] }
  }
  return { blocked: false, result, triggered }
}

/**
 * Снимает блокировку входа с учётной записи — со всех адресов.
 *
 * Нужна, когда администратор выдал новый временный пароль: чаще всего его просят
 * именно после пяти неудачных попыток, и без снятия человек с новым паролем
 * ещё 15 минут получал бы «слишком много попыток». Счётчики адресов не трогаются:
 * они про перебор многих учётных записей, а не этой.
 */
export function releaseAccount(account: string): void {
  const suffix = `\n${account}`
  for (const key of byAccountAndAddress.keys()) {
    if (key.endsWith(suffix)) byAccountAndAddress.forget(key)
  }
  byAccount.forget(account)
}

/** Только для тестов: сколько записей держит каждый счётчик. */
export function trackedCounts(): { byAccountAndAddress: number; byAddress: number; byAccount: number } {
  return {
    byAccountAndAddress: byAccountAndAddress.size,
    byAddress: byAddress.size,
    byAccount: byAccount.size,
  }
}

/** Только для тестов: состояние процесса между ними протекать не должно. */
export function resetThrottle(): void {
  byAccountAndAddress.clear()
  byAddress.clear()
  byAccount.clear()
}
