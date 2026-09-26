import { headers } from 'next/headers'
import { prisma } from '@/shared/db/prisma'
import { containsNul } from '@/shared/db/storable'
import type { UserRole } from '@/shared/contracts/enums'
import { writeAudit } from '@/shared/audit/audit'
import { clientAddress, UNKNOWN_ADDRESS } from './throttle'
import { loginAuditEntries, type LoginOutcome } from './login-audit'

/**
 * Единый вход через Keycloak (ТЗ, функц. 10; решение 188).
 *
 * NextAuth поддерживает провайдер Keycloak «из коробки» (`next-auth/providers/keycloak`,
 * OpenID Connect) — маршруты `/api/*` не меняются совсем, только `shared/auth/auth.ts`
 * получает провайдер рядом с Credentials. Keycloak сам проверяет пароль и решает,
 * прошёл ли человек защиту от перебора (`bruteForceProtected` в реалме) — то, что уходит
 * в NextAuth, это уже подтверждённая личность (email из токена), не пароль.
 *
 * Права, роль, вуз и блокировка остаются собственностью SkillLink, а не Keycloak:
 * пользователь Keycloak сопоставляется с записью `users` по email
 * (`resolveKeycloakLoginUser`), и дальше всё как у обычного входа — та же таблица,
 * тот же `getCurrentUser()`, та же версия сессий (решение 109). Неизвестный email
 * или заблокированная запись (`isActive: false`) получают одинаковый отказ — по тем же
 * причинам, что у Credentials (не раскрывать, какие адреса существуют).
 *
 * Провайдер регистрируется только при заданных всех трёх переменных
 * (`KEYCLOAK_ISSUER`, `KEYCLOAK_CLIENT_ID`, `KEYCLOAK_CLIENT_SECRET`) — иначе всё
 * как раньше, это и есть откат без единой правки кода.
 */
export function isKeycloakEnabled(): boolean {
  return Boolean(
    process.env.KEYCLOAK_ISSUER?.trim() &&
      process.env.KEYCLOAK_CLIENT_ID?.trim() &&
      process.env.KEYCLOAK_CLIENT_SECRET?.trim(),
  )
}

/** Те же поля, что несёт токен Credentials-входа (`SessionUser` в `auth.ts`). */
export interface KeycloakLoginUser {
  id: string
  email: string
  fullName: string
  role: UserRole
  universityId: string | null
  sessionVersion: number
}

export type KeycloakLoginResult =
  | { outcome: 'ok'; user: KeycloakLoginUser }
  /**
   * Отказ: почта не пришла в токене Keycloak, учётной записи с ней нет в базе,
   * либо она заблокирована (`isActive: false`). Один и тот же исход для всех
   * трёх случаев — по нему нельзя понять, существует ли почта, так же как
   * при обычном входе неверный пароль неотличим от несуществующего адреса.
   */
  | { outcome: 'denied' }

/**
 * Сопоставление входа Keycloak с пользователем SkillLink по email.
 *
 * Учётная запись ищется в базе заново при каждой попытке, а не берётся из
 * токена Keycloak, — ровно как быстрый вход эксперта (`expert-quick-login.ts`)
 * перечитывает `is_reviewer`: то, что Keycloak счёл вход успешным, не значит,
 * что у этой почты есть доступ к SkillLink или что доступ не отозван.
 */
export async function resolveKeycloakLoginUser(rawEmail: string | null | undefined): Promise<KeycloakLoginResult> {
  const email = typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : ''
  if (!email || containsNul(email)) return { outcome: 'denied' }

  const user = await prisma.user.findFirst({
    where: { email, isActive: true },
    select: { id: true, email: true, fullName: true, role: true, universityId: true, sessionVersion: true },
  })
  if (!user) return { outcome: 'denied' }
  return { outcome: 'ok', user }
}

/** Адрес клиента для журнала — тот же заголовок, что у обычного входа (throttle.ts). */
async function currentClientAddress(): Promise<string> {
  try {
    return clientAddress(await headers())
  } catch {
    // Вне контекста запроса (тесты, скрипты) — как отсутствие заголовка.
    return UNKNOWN_ADDRESS
  }
}

/**
 * Запись в журнал действий о входе через Keycloak — `auth.login.success` /
 * `.failure`, тот же формат, что у Credentials (`login-audit.ts`), с пометкой
 * `sso: true` у успеха, чтобы при разборе инцидента отличить способ входа.
 */
export async function auditKeycloakLogin(result: KeycloakLoginResult): Promise<void> {
  const address = await currentClientAddress()
  const outcome: LoginOutcome =
    result.outcome === 'ok'
      ? { kind: 'success', userId: result.user.id, address, sso: true }
      : { kind: 'failure', userId: null, address, triggered: [] }
  for (const entry of loginAuditEntries(outcome)) await writeAudit(entry)
}
