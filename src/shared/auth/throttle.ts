import { LOGIN_THROTTLE } from '@/shared/config/auth.config'

/**
 * Ограничение перебора пароля.
 *
 * Счётчик ведётся по учётной записи, а не по адресу клиента: цель — не дать подобрать
 * пароль к конкретному пользователю. Перебор с множества адресов от этого не спасает,
 * но именно он и не является угрозой MVP.
 *
 * Состояние живёт в памяти процесса. При нескольких экземплярах приложения у каждого
 * будет свой счётчик, а перезапуск его обнуляет — ограничение честно описано
 * в docs/SECURITY_LIMITATIONS.md. Хранилище (Redis или таблица) — отдельная задача.
 */
export interface ThrottleState {
  failures: number
  /** Время первой неудачи в текущем окне. */
  windowStartedAt: number
  /** До какого момента вход закрыт. null — не закрыт. */
  blockedUntil: number | null
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
export function registerFailure(state: ThrottleState | undefined, now: number): ThrottleState {
  if (isBlocked(state, now)) return state as ThrottleState

  const withinWindow =
    state !== undefined && now - state.windowStartedAt <= LOGIN_THROTTLE.windowMs

  const failures = withinWindow ? state.failures + 1 : 1
  const windowStartedAt = withinWindow ? state.windowStartedAt : now

  return {
    failures,
    windowStartedAt,
    blockedUntil: failures >= LOGIN_THROTTLE.maxFailures ? now + LOGIN_THROTTLE.blockMs : null,
  }
}

/** Сколько секунд осталось до снятия блокировки. Для сообщения и журнала. */
export function secondsUntilUnblocked(state: ThrottleState | undefined, now: number): number {
  if (!isBlocked(state, now)) return 0
  return Math.ceil(((state as ThrottleState).blockedUntil! - now) / 1000)
}

// ── Хранилище в памяти процесса ──────────────────────────────────────────────

const states = new Map<string, ThrottleState>()

/** Убирает записи, которые уже ничего не ограничивают. */
function prune(now: number): void {
  for (const [key, state] of states) {
    const expired =
      !isBlocked(state, now) && now - state.windowStartedAt > LOGIN_THROTTLE.windowMs
    if (expired) states.delete(key)
  }
}

export function checkLogin(accountKey: string, now = Date.now()): { blocked: boolean; retryAfterSeconds: number } {
  const state = states.get(accountKey)
  return { blocked: isBlocked(state, now), retryAfterSeconds: secondsUntilUnblocked(state, now) }
}

export function recordFailure(accountKey: string, now = Date.now()): void {
  prune(now)

  // Перебор по несуществующим адресам не должен раздувать карту без предела.
  if (!states.has(accountKey) && states.size >= LOGIN_THROTTLE.maxTrackedAccounts) return

  states.set(accountKey, registerFailure(states.get(accountKey), now))
}

export function recordSuccess(accountKey: string): void {
  states.delete(accountKey)
}

/** Только для тестов: состояние процесса между ними протекать не должно. */
export function resetThrottle(): void {
  states.clear()
}
