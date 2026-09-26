import { handlers } from '@/shared/auth/auth'
import { withMetrics } from '@/shared/http/metrics-guard'
import { withRateLimit } from '@/shared/http/rate-limit-guard'

/**
 * Маршруты NextAuth.js: /api/auth/signin, /api/auth/callback/credentials,
 * /api/auth/session, /api/auth/signout, /api/auth/csrf.
 *
 * Фронт входит через `signIn('credentials', { email, password })` из `next-auth/react`.
 *
 * Под общим ограничением частоты (решение 117): вход и выход — группа `auth`
 * по адресу клиента, чтение сессии и csrf-токена — обычное чтение.
 * В метриках — одной меткой `/api/auth/[...nextauth]` (решение 137).
 */
export const GET = withMetrics(withRateLimit(handlers.GET))
export const POST = withMetrics(withRateLimit(handlers.POST))
