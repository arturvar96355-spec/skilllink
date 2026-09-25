import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Отзыв выданных сессий (решение 109).
 *
 * Сессии — JWT в cookie, в базе их нет, поэтому «удалить сессию» нельзя. Вместо
 * этого у пользователя есть номер версии (`users.session_version`): он кладётся
 * в токен при входе, а `getCurrentUser()` на каждом запросе сверяет его с базой.
 * Смена и сброс пароля, блокировка и смена роли увеличивают номер — все токены,
 * выданные раньше, перестают совпадать.
 *
 * Модуль без NextAuth и Prisma: сверка и подпись проверяются тестом без окружения.
 */

/**
 * Версия из токена.
 *
 * Поля нет — токен выдан до появления версий: он считается версией 0, как и все
 * пользователи после миграции. Иначе выкладка разлогинила бы всех разом.
 * Что-то кроме неотрицательного целого — не наша запись: −1, с базой не совпадёт.
 */
export function tokenSessionVersion(value: unknown): number {
  if (value === undefined || value === null) return 0
  return isVersion(value) ? value : -1
}

function isVersion(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

/** Сессия действует, только пока её версия равна версии в базе. */
export function isSessionCurrent(tokenVersion: unknown, storedVersion: number): boolean {
  return tokenSessionVersion(tokenVersion) === storedVersion
}

// ── Продление текущей сессии после смены своего пароля ──────────────────────

/**
 * Разрешение переписать версию в токене текущей сессии.
 *
 * Сменивший пароль не должен вылетать сам: сервер переоформляет его токен с новой
 * версией (`unstable_update` → колбэк `jwt` с `trigger: 'update'`). Но тот же колбэк
 * вызывает и клиент — `POST /api/auth/session` с любыми данными. Без подписи
 * украденная cookie сама «продлила» бы себя до новой версии, и отзыв бы не сработал.
 *
 * Поэтому данные обновления — подписанное сервером разрешение: чей токен, с какой
 * версии на какую, до какого времени. Подпись — HMAC секретом сессий; клиенту
 * разрешение не отдаётся, оно живёт одну серверную операцию.
 */
export interface SessionRenewal {
  userId: string
  from: number
  to: number
}

/** Разрешение живёт минуту: его применяют в том же запросе, что и выпускают. */
export const RENEWAL_TTL_MS = 60_000

/** Отдельная «область» подписи: HMAC тем же секретом нигде больше не совпадёт с этим. */
const RENEWAL_DOMAIN = 'skilllink:session-renewal:v1'

function mac(payload: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(`${RENEWAL_DOMAIN}\n${payload}`).digest()
}

export function signSessionRenewal(renewal: SessionRenewal, secret: string, now = Date.now()): string {
  const payload = Buffer.from(
    JSON.stringify({ u: renewal.userId, f: renewal.from, t: renewal.to, e: now + RENEWAL_TTL_MS }),
  ).toString('base64url')
  return `${payload}.${mac(payload, secret).toString('base64url')}`
}

/** Разрешение, если подпись верна и срок не вышел; иначе null. Никогда не бросает. */
export function verifySessionRenewal(grant: unknown, secret: string, now = Date.now()): SessionRenewal | null {
  if (typeof grant !== 'string' || grant.length > 1024) return null
  const [payload, signature, ...rest] = grant.split('.')
  if (!payload || !signature || rest.length > 0) return null

  const expected = mac(payload, secret)
  const given = Buffer.from(signature, 'base64url')
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null

  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>
    const { u, f, t, e } = data
    if (typeof u !== 'string' || typeof e !== 'number' || e < now) return null
    if (!isVersion(f) || !isVersion(t)) return null
    return { userId: u, from: f, to: t }
  } catch {
    return null
  }
}

/**
 * Новая версия для токена при обновлении сессии — или null, если обновлять нечего.
 *
 * Применяется, только когда разрешение выдано этому же пользователю и именно для
 * той версии, что сейчас в токене: уже отозванный токен разрешением не оживить.
 */
export function renewedSessionVersion(
  token: Record<string, unknown>,
  update: unknown,
  secret: string,
  now = Date.now(),
): number | null {
  const grant =
    update !== null && typeof update === 'object' && 'sessionRenewal' in update
      ? (update as { sessionRenewal: unknown }).sessionRenewal
      : undefined
  const renewal = verifySessionRenewal(grant, secret, now)
  if (!renewal) return null
  if (renewal.userId !== token.id) return null
  if (renewal.from !== tokenSessionVersion(token.sessionVersion)) return null
  return renewal.to
}
