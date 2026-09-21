import { handlers } from '@/shared/auth/auth'

/**
 * Маршруты NextAuth.js: /api/auth/signin, /api/auth/callback/credentials,
 * /api/auth/session, /api/auth/signout, /api/auth/csrf.
 *
 * Фронт входит через `signIn('credentials', { email, password })` из `next-auth/react`.
 */
export const { GET, POST } = handlers
