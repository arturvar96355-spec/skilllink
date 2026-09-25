import { handle } from '@/shared/http'
import * as service from '@/modules/calendar/calendar.service'

/**
 * Лента календаря: GET /api/calendar/<токен>.ics (решение 105).
 *
 * Без входа — календарные приложения cookie не шлют; доступ даёт сам токен
 * в адресе. Неизвестный или отозванный токен и заблокированный владелец —
 * одинаковый 404. Кэш запрещён и здесь, и в next.config.ts: лента личная,
 * и промежуточный кэш не должен отдавать её после отзыва.
 */
export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ feed: string }> }

export const GET = handle<Context>(async (_request, context) => {
  const { feed } = await context.params
  const body = await service.renderFeed(feed)
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'text/calendar; charset=utf-8',
      'content-disposition': 'inline; filename="skilllink.ics"',
      'cache-control': 'no-store',
      // Ссылку могут случайно опубликовать — поисковику индексировать её незачем.
      'x-robots-tag': 'noindex, nofollow',
    },
  })
})
