import { NextResponse } from 'next/server'
import { withRateLimit } from '@/shared/http/rate-limit-guard'

/**
 * Ответ на несуществующий адрес API.
 *
 * Без этого маршрута опечатка в пути отдаёт HTML-страницу 404, и на фронте
 * `response.json()` падает с «Unexpected token '<'». Ошибка выглядит как поломка
 * разбора ответа, хотя на деле это просто неверный адрес — на поиск причины
 * уходит время на ровном месте.
 *
 * Перехватывающий сегмент имеет наименьший приоритет: все настоящие маршруты,
 * включая `/api/auth/[...nextauth]`, сопоставляются раньше.
 *
 * Перебор адресов тоже расходует предел частоты запросов (решение 117).
 */
const notFound = withRateLimit(async (): Promise<Response> => {
  return NextResponse.json(
    {
      error: {
        code: 'NOT_FOUND',
        message: 'Такого адреса в API нет. Сверьтесь с docs/API_CONTRACT.md или GET /api/openapi.json',
      },
    },
    { status: 404 },
  )
})

export const GET = notFound
export const POST = notFound
export const PUT = notFound
export const PATCH = notFound
export const DELETE = notFound
export const HEAD = notFound
export const OPTIONS = notFound
