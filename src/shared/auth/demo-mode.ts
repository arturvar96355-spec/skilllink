/**
 * Демо-режим: вход без пароля по cookie и выбор пользователя по умолчанию.
 *
 * Включён везде, кроме продакшена. Отключается переменной `DEMO_AUTH_ENABLED=false`,
 * и тогда остаётся только настоящая аутентификация. Держать его включённым
 * в промышленном контуре нельзя — это обход авторизации, и об этом сказано
 * в docs/SECURITY_LIMITATIONS.md.
 *
 * Модуль намеренно не зависит ни от NextAuth, ни от Prisma: это чтение настройки,
 * и оно должно проверяться тестом без поднятой базы и без окружения Next.
 */
export function isDemoAuthEnabled(): boolean {
  const raw = process.env.DEMO_AUTH_ENABLED
  if (raw === 'true' || raw === '1') return true
  if (raw === 'false' || raw === '0') return false
  return process.env.NODE_ENV !== 'production'
}

/**
 * Имя cookie демонстрационного режима: позволяет переключать пользователя без пароля.
 * Работает только когда включён демо-режим.
 */
export const DEMO_USER_COOKIE = 'skilllink_user'
