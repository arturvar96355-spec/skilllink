import { resolveSecret, unstable_update } from './auth'
import { describeAuthError } from './current-user'
import { signSessionRenewal } from './session-version'
import { log } from '@/shared/log/logger'

/**
 * Переоформить текущую сессию на новую версию после смены своего пароля (решение 109).
 *
 * `unstable_update` — штатный серверный способ NextAuth v5 обновить JWT: он вызывает
 * колбэк `jwt` с `trigger: 'update'` на cookie текущего запроса и кладёт новую cookie
 * в ответ маршрута. Данные обновления — подписанное разрешение (session-version.ts):
 * без него колбэк версию не меняет.
 *
 * Не вышло (нет сессии — вход демо-cookie, сбой библиотеки) — `false`, без исключения:
 * пароль уже сменён, а сессия просто закроется на следующем запросе, как остальные.
 * Сбой в сторону «выйти», а не «остаться со старой версией».
 */
export async function renewCurrentSession(userId: string, sessionVersion: number): Promise<boolean> {
  try {
    const sessionRenewal = signSessionRenewal(
      { userId, from: sessionVersion - 1, to: sessionVersion },
      resolveSecret(),
    )
    // Тип данных обновления в NextAuth — частичная сессия; разрешение — наше поле.
    const session = await unstable_update({ sessionRenewal } as unknown as Parameters<typeof unstable_update>[0])
    return session?.user?.id === userId && session.user.sessionVersion === sessionVersion
  } catch (error) {
    log.error('[AUTH] не удалось продлить сессию после смены пароля', { reason: describeAuthError(error) })
    return false
  }
}
