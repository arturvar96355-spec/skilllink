import { createHash } from 'node:crypto'
import { NextResponse } from 'next/server'
import { isDemoAuthEnabled } from '@/shared/auth/demo-mode'
import { isSharedDemoAccount } from '@/shared/config/auth.config'
import { RATE_LIMITS, RATE_LIMIT_TEST_HEADER, type RateLimitGroup } from '@/shared/config/rate-limit.config'
import { log } from '@/shared/log'
import { countSafely } from '@/shared/metrics/app-metrics'
import {
  RateLimitStore,
  calendarFeedToken,
  clientAddressFromHeaders,
  rateLimitGroup,
  rateLimitHeaders,
  type RateLimitDecision,
} from './rate-limit'

/**
 * Ограничение частоты запросов в обработчиках маршрутов API (решение 117).
 *
 * Проверка идёт в Node, а не в middleware: middleware Next работает в edge-среде,
 * где нет ни проверки сессии, ни журнала, — и API-маршруты он не обслуживает
 * вовсе (src/middleware.ts). Сюда запрос попадает через `handle()` — обёртку
 * всех маршрутов API — и через `withRateLimit()` у маршрутов NextAuth и
 * «нет такого адреса».
 *
 * **Хранилище — память процесса.** Приложение на сервере — один процесс
 * `next start`. Таблица в Postgres превратила бы каждое чтение API в запись
 * в базу: под потоком запросов сам ограничитель стал бы той нагрузкой, от
 * которой защищает. Счётчики минутные — перезапуск теряет не больше двух минут
 * счёта. Граница (несколько экземпляров — у каждого свой счёт) —
 * в docs/SECURITY_LIMITATIONS.md.
 *
 * **Сбой — запрос пропускается** (fail-open) с предупреждением в журнал сервера.
 * Ограничение частоты — защита от перегрузки, а не проверка прав: права
 * проверяет сам маршрут. Отказ всем из-за ошибки ограничителя — та же
 * недоступность, от которой он защищает, только наверняка.
 */

const store = new RateLimitStore()

/** Кто расходует предел: пользователь, адрес клиента или лента календаря. */
export type SubjectKind = 'user' | 'address' | 'feed'

export interface RateLimitSubject {
  kind: SubjectKind
  key: string
  /** Для журнала: id вошедшего пользователя, если субъект — он. */
  userId: string | null
}

interface SessionIdentity {
  id: string
  email: string | null
}

/**
 * Пользователь из подписанной сессии NextAuth, без запроса к базе.
 *
 * Только настоящая сессия: демо-cookie задаёт сам клиент, и считать по ней —
 * значит дать сменой значения новый счётчик. Модуль входа подгружается при
 * первом вызове: `shared/http` импортируют все сервисы, и тянуть в каждый
 * NextAuth ради обёртки маршрутов незачем.
 */
async function sessionIdentity(): Promise<SessionIdentity | null> {
  try {
    const { auth } = await import('@/shared/auth/auth')
    const session = await auth()
    const id = session?.user?.id
    return id ? { id, email: session.user?.email ?? null } : null
  } catch {
    // Сессию не прочитать — считаем по адресу. Отказ по сессии даст сам маршрут.
    return null
  }
}

const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex').slice(0, 32)

export async function resolveSubject(
  request: Request,
  group: RateLimitGroup,
  pathname: string,
  readSession: () => Promise<SessionIdentity | null> = sessionIdentity,
): Promise<RateLimitSubject> {
  const address = clientAddressFromHeaders(request.headers)
  const byAddress: RateLimitSubject = { kind: 'address', key: `ip:${address}`, userId: null }

  if (group === 'feed') {
    // Токен — секрет подписки: в памяти только его хеш.
    const token = calendarFeedToken(pathname)
    return token ? { kind: 'feed', key: `feed:${hashToken(token)}`, userId: null } : byAddress
  }
  // Вход считается по адресу всегда: сессия тут ещё не выдана или меняется.
  if (group === 'auth') return byAddress

  const user = await readSession()
  if (!user) return byAddress
  // Под общей демо-учёткой стенда сидят все проверяющие сразу (auth.config.ts):
  // один общий счёт отдал бы предел одного — всем. У каждого адреса свой.
  const key = user.email && isSharedDemoAccount(user.email) ? `u:${user.id}@${address}` : `u:${user.id}`
  return { kind: 'user', key, userId: user.id }
}

/**
 * В демо-режиме общий счёт только считает: заголовки `RateLimit-*` уходят,
 * 429 — нет.
 *
 * Демо-режим — это вход без пароля: разработка, CI и запасной ноутбук, на стенде
 * он выключен (scripts/deploy/check.sh это проверяет). Там по API ходят скрипты:
 * сквозной сценарий делает сотни запросов за пару секунд, и все — с одного
 * адреса под демо-cookie, которую субъектом считать нельзя. Отказы по общему
 * счёту ломали бы их, ничего не защищая: кто может войти без пароля, тому
 * ограничение частоты не помеха. Срабатывание 429 там проверяется отдельным
 * счётом пробника (testOverrideLimit).
 */
function observeOnly(decision: RateLimitDecision): RateLimitDecision {
  if (decision.allowed) return decision
  return { ...decision, allowed: true, remaining: 0, retryAfterSeconds: 0, firstRejection: false }
}

/** Предел пробника: только в демо-режиме, только положительное целое. */
export function testOverrideLimit(): number | null {
  const raw = process.env.RATE_LIMIT_TEST_OVERRIDE?.trim()
  if (!raw || !isDemoAuthEnabled()) return null
  const value = Number(raw)
  return Number.isInteger(value) && value > 0 ? value : null
}

export interface RateLimitVerdict {
  decision: RateLimitDecision
  group: RateLimitGroup
  subject: RateLimitSubject
}

/**
 * Засчитывает запрос. `null` — маршрут не ограничивается или ограничитель
 * сломался (тогда запрос пропускается).
 */
export async function consumeRateLimit(
  request: Request,
  now: number = Date.now(),
  readSession?: () => Promise<SessionIdentity | null>,
): Promise<RateLimitVerdict | null> {
  try {
    const { pathname } = new URL(request.url)
    const group = rateLimitGroup(request.method, pathname)
    if (group === null) return null

    const subject = await resolveSubject(request, group, pathname, readSession)

    const enforce = !isDemoAuthEnabled()
    const consumeMain = (): RateLimitDecision => {
      const decision = store.consume(`${group}|${subject.key}`, RATE_LIMITS[group], now)
      return enforce ? decision : observeOnly(decision)
    }

    // Пробник: свой счёт с низким пределом, в дополнение к общему, и отказ по нему
    // действует и в демо-режиме. Отклонённый здесь запрос до общего счёта
    // не доходит — отказ не засчитывается нигде.
    const override = testOverrideLimit()
    const testKey = request.headers.get(RATE_LIMIT_TEST_HEADER)
    if (override !== null && testKey !== null && /^[\w-]{1,64}$/.test(testKey)) {
      const test = store.consume(`test|${group}|${testKey}`, override, now)
      if (!test.allowed) return { decision: test, group, subject }
      const main = consumeMain()
      return { decision: main.allowed ? test : main, group, subject }
    }

    return { decision: consumeMain(), group, subject }
  } catch (error) {
    log.warn('[RATE_LIMIT] ограничитель не сработал, запрос пропущен', { err: error })
    return null
  }
}

/**
 * Запись в журнал действий о превышении — одна на ключ в минуту, а не на каждый
 * отказ: иначе поток запросов превращался бы в поток записей в базу. Адрес
 * клиента и путь не пишутся: адрес — персональные данные, в пути ленты — токен.
 */
async function reportRejection(verdict: RateLimitVerdict): Promise<void> {
  try {
    const { writeAudit } = await import('@/shared/audit/audit')
    await writeAudit({
      userId: verdict.subject.userId,
      action: 'api.rate-limit.exceeded',
      objectType: 'User',
      objectId: verdict.subject.userId ?? 'unknown',
      payload: {
        group: verdict.group,
        limit: verdict.decision.limit,
        subject: verdict.subject.kind,
      },
    })
  } catch (error) {
    log.warn('[RATE_LIMIT] не удалось записать превышение в журнал', { err: error })
  }
}

/** Страница входа. За прокси адрес запроса у Next — собственный (localhost), публичный — в AUTH_URL. */
function loginUrl(request: Request): URL {
  try {
    return new URL('/login', process.env.AUTH_URL || request.url)
  } catch {
    return new URL('/login', request.url)
  }
}

/** Код отказа в адресе перенаправления входа — рядом с `too_many_attempts` и `captcha_required`. */
export const LOGIN_RATE_LIMITED_CODE = 'rate_limited'

/**
 * Ответ 429 в формате ошибок контракта.
 *
 * Вход через `signIn()` из `next-auth/react` ждёт в ответе поле `url` и разбирает
 * из него `error` и `code`; без него экран входа сказал бы «Сервер не ответил».
 * Поэтому запросу NextAuth (заголовок `X-Auth-Return-Redirect`) добавляется
 * `url` на страницу входа с `code=rate_limited`.
 */
export function rateLimitedResponse(request: Request, decision: RateLimitDecision): NextResponse {
  const seconds = decision.retryAfterSeconds
  const body: Record<string, unknown> = {
    error: {
      code: 'RATE_LIMITED',
      message: `Слишком много запросов. Подождите ${seconds} с и повторите`,
      details: { retryAfterSeconds: seconds },
    },
  }
  if (request.headers.get('x-auth-return-redirect') !== null) {
    const url = loginUrl(request)
    url.searchParams.set('error', 'CredentialsSignin')
    url.searchParams.set('code', LOGIN_RATE_LIMITED_CODE)
    body.url = url.toString()
  }
  return NextResponse.json(body, { status: 429, headers: rateLimitHeaders(decision) })
}

/**
 * Заголовки `RateLimit-*` на готовый ответ. У ответа с неизменяемыми
 * заголовками (Response.redirect, ответ fetch) — копия с теми же телом и статусом.
 */
export function withRateLimitHeaders(response: Response, decision: RateLimitDecision): Response {
  const headers = rateLimitHeaders(decision)
  try {
    for (const [name, value] of Object.entries(headers)) response.headers.set(name, value)
    return response
  } catch {
    const copy = new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    })
    for (const [name, value] of Object.entries(headers)) copy.headers.set(name, value)
    return copy
  }
}

/**
 * Обёртка обработчика маршрута: сначала счёт, потом обработчик.
 * Отказ — 429 без вызова обработчика; остальным ответам — заголовки `RateLimit-*`.
 */
export function withRateLimit<Req extends Request, Args extends unknown[]>(
  fn: (request: Req, ...rest: Args) => Promise<Response> | Response,
): (request: Req, ...rest: Args) => Promise<Response> {
  return async (request, ...rest) => {
    const verdict = await consumeRateLimit(request)
    if (verdict && !verdict.decision.allowed) {
      countSafely((metrics) => metrics.rateLimitRejections.inc({ group: verdict.group }))
      if (verdict.decision.firstRejection) await reportRejection(verdict)
      return rateLimitedResponse(request, verdict.decision)
    }
    const response = await fn(request, ...rest)
    return verdict ? withRateLimitHeaders(response, verdict.decision) : response
  }
}

/** Только для тестов: счётчики процесса между тестами протекать не должны. */
export function resetRateLimit(): void {
  store.clear()
}
