import { handlers } from '@/shared/auth/auth'
import { withRateLimit } from '@/shared/http/rate-limit-guard'

/**
 * Маршруты NextAuth.js: /api/auth/signin, /api/auth/callback/credentials,
 * /api/auth/session, /api/auth/signout, /api/auth/csrf.
 *
 * Фронт входит через `signIn('credentials', { email, password })` из `next-auth/react`.
 *
 * Под общим ограничением частоты (решение 117): вход и выход — группа `auth`
 * по адресу клиента, чтение сессии и csrf-токена — обычное чтение.
 */
export const GET = withRateLimit(handlers.GET)
export const POST = withRateLimit(handlers.POST)
