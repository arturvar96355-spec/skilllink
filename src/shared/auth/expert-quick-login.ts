import { prisma } from '@/shared/db/prisma'
import type { UserRole } from '@/shared/contracts/enums'
import { writeAudit } from '@/shared/audit/audit'
import { alertAdminLogin } from '@/shared/ops/security-alerts'
import { countSafely } from '@/shared/metrics/app-metrics'
import { EXPERT_QUICK_LOGIN_ROLES } from '@/shared/config/auth.config'
import { throttledAttempt } from './throttle'
import { loginAuditEntries, type LoginOutcome } from './login-audit'

/**
 * Быстрый вход экспертов хакатона (решение 176): кнопки на `/login` входят без
 * пароля в готовые учётные записи экспертов (решение 147 — `expert-manager@`,
 * `expert-admin@`, `expert-rep@skilllink.demo`, флаг `users.is_reviewer`).
 *
 * Безопасно ровно по трём причинам, а не потому, что кнопки не видны никому
 * постороннему:
 *
 * 1. **Только чтение.** Учётная запись эксперта и без быстрого входа не может
 *    ничего изменить — `assertReviewerAllowed` отклоняет любое разрушающее
 *    действие 403 независимо от роли (решение 147). Кнопка убирает пароль,
 *    а не право.
 * 2. **Только демо-данные, только учётные записи с `is_reviewer = true` —
 *    и это проверяется в базе на каждый клик**, а не по списку в браузере.
 *    Клиент присылает лишь ключ кнопки (`manager` | `admin` | `rep`); сервер
 *    сам решает, какой почте он соответствует (`EXPERT_QUICK_LOGIN_EMAILS`,
 *    ниже — единственное место с этим знанием), и ищет пользователя в базе
 *    заново с условием `isReviewer: true`. Подделать ключ на чужую учётную
 *    запись нельзя: ключей всего три, они не параметризуются почтой.
 * 3. **Выключается переменной окружения** `EXPERT_QUICK_LOGIN` (по умолчанию
 *    выключено). Выключено — на `/login` нет блока (страница читает флаг на
 *    сервере, `isExpertQuickLoginEnabled()`), провайдер `expert` не
 *    регистрируется в NextAuth (`shared/auth/auth.ts`), а прямой запрос
 *    к `/api/auth/{signin,callback}/expert` отвечает 404
 *    (`expertQuickLoginRouteBlocked`, используется в
 *    `src/app/api/auth/[...nextauth]/route.ts`) — как «нет такого адреса»,
 *    а не как отказ провайдера.
 *
 * Сессия создаётся тем же механизмом, что обычный вход: отдельный
 * Credentials-провайдер NextAuth, тот же JWT на 8 часов, та же версия сессий,
 * тот же счётчик перебора «учётная запись + адрес» (throttle.ts, тем самым —
 * то же общее ограничение частоты запросов на `/api/auth/*`, решение 117) и
 * та же запись в журнал действий — с пометкой `quickLogin: true`, чтобы при
 * разборе инцидента отличить от входа паролем. Проверка «не робот» не нужна:
 * пароль здесь не перебирают, перебирать нечего.
 */
export function isExpertQuickLoginEnabled(): boolean {
  const raw = process.env.EXPERT_QUICK_LOGIN
  return raw === 'true' || raw === '1'
}

/**
 * Ключ кнопки → почта учётной записи эксперта. Единственное место, которое
 * знает связь: клиент видит только ключ и подпись (`EXPERT_QUICK_LOGIN_ROLES`,
 * `shared/config/auth.config.ts` — без адреса почты, чтобы не тащить его
 * в клиентский код без необходимости).
 */
const EXPERT_QUICK_LOGIN_EMAILS: Readonly<Record<string, string>> = {
  manager: 'expert-manager@skilllink.demo',
  admin: 'expert-admin@skilllink.demo',
  rep: 'expert-rep@skilllink.demo',
}

/** Ключи, которые действительно показаны кнопкой (`shared/config/auth.config.ts`). */
const VALID_KEYS = new Set(EXPERT_QUICK_LOGIN_ROLES.map((role) => role.key))

function expertQuickLoginEmail(key: string): string | null {
  if (!VALID_KEYS.has(key)) return null
  return EXPERT_QUICK_LOGIN_EMAILS[key] ?? null
}

export interface ExpertQuickLoginUser {
  id: string
  email: string
  fullName: string
  role: UserRole
  universityId: string | null
  sessionVersion: number
}

export type ExpertQuickLoginResult =
  | { outcome: 'ok'; user: ExpertQuickLoginUser }
  /** Вход закрыт ограничением перебора (throttle.ts) — тот же счётчик, что у обычного входа. */
  | { outcome: 'blocked' }
  /**
   * Отказ: неизвестный ключ кнопки, либо учётная запись с этой почтой не найдена
   * или не помечена `is_reviewer = true`. Одна и та же причина отказа для обоих
   * случаев — по ней нельзя понять, существует ли почта, так же как при обычном
   * входе неверный пароль неотличим от несуществующего адреса.
   */
  | { outcome: 'denied' }

/**
 * Проверка и вход по ключу кнопки экрана входа.
 *
 * Учётная запись ищется в базе заново при каждой попытке — список кнопок
 * в браузере ничего не решает, решает только это условие (`isActive`,
 * `isReviewer: true`). Обычная учётная запись, даже угадав или подделав ключ,
 * этой проверки не пройдёт: `is_reviewer` не задан.
 */
export async function attemptExpertQuickLogin(key: string, address: string): Promise<ExpertQuickLoginResult> {
  const email = expertQuickLoginEmail(key)
  if (!email) return { outcome: 'denied' }

  const source = { account: email, address }
  const attempt = await throttledAttempt(source, () =>
    prisma.user.findFirst({
      where: { email, isActive: true, isReviewer: true },
      select: { id: true, email: true, fullName: true, role: true, universityId: true, sessionVersion: true },
    }),
  )

  if (attempt.blocked) {
    countSafely((metrics) => metrics.loginFailures.inc({ reason: 'throttled' }))
    return { outcome: 'blocked' }
  }

  const user = attempt.result
  if (!user) countSafely((metrics) => metrics.loginFailures.inc({ reason: 'credentials' }))

  const outcome: LoginOutcome = user
    ? { kind: 'success', userId: user.id, address, quickLogin: true }
    : { kind: 'failure', userId: null, address, triggered: attempt.triggered }
  for (const entry of loginAuditEntries(outcome)) await writeAudit(entry)

  if (!user) return { outcome: 'denied' }

  // Оповещение владельцу (решение 118) — как при обычном входе администратора.
  if (user.role === 'ADMIN') alertAdminLogin(user.id, address, new Date())

  return { outcome: 'ok', user }
}

/** Пути NextAuth, которыми пользуется провайдер `expert`: signin и callback. */
const EXPERT_PROVIDER_PATH = /^\/api\/auth\/(?:signin|callback)\/expert(?:\/.*)?$/

/**
 * Выключенный быстрый вход — это «нет такого адреса», а не отказ провайдера:
 * прямой запрос к его маршрутам должен отвечать 404 независимо от того,
 * зарегистрирован ли в этот момент сам провайдер (проверяется одной и той же
 * переменной, что определяет и то, показывать ли блок на экране входа).
 */
export function expertQuickLoginRouteBlocked(pathname: string): boolean {
  return EXPERT_PROVIDER_PATH.test(pathname) && !isExpertQuickLoginEnabled()
}
