import { NextResponse, type NextRequest } from 'next/server'
import { handlers } from '@/shared/auth/auth'
import { expertQuickLoginRouteBlocked } from '@/shared/auth/expert-quick-login'
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

/**
 * Быстрый вход экспертов (решение 176) выключен переменной `EXPERT_QUICK_LOGIN` —
 * тогда его маршруты (`signin/expert`, `callback/expert`) отвечают тем же 404,
 * что и любой несуществующий адрес API (`src/app/api/[...unknown]/route.ts`),
 * а не отказом провайдера NextAuth: снаружи не должно быть заметно, есть кнопка
 * на стенде или нет.
 */
async function guardExpertQuickLogin(request: Request): Promise<Response | null> {
  const pathname = new URL(request.url).pathname
  if (!expertQuickLoginRouteBlocked(pathname)) return null
  return NextResponse.json(
    {
      error: {
        code: 'NOT_FOUND',
        message: 'Такого адреса в API нет. Сверьтесь с docs/API_CONTRACT.md или GET /api/openapi.json',
      },
    },
    { status: 404 },
  )
}

export const GET = withMetrics(
  withRateLimit(async (request: NextRequest) => (await guardExpertQuickLogin(request)) ?? handlers.GET(request)),
)
export const POST = withMetrics(
  withRateLimit(async (request: NextRequest) => (await guardExpertQuickLogin(request)) ?? handlers.POST(request)),
)
