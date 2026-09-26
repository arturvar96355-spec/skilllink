import { timingSafeEqual } from 'node:crypto'
import { serviceUnavailable, unauthorized } from '@/shared/http/errors'

/**
 * Авторизация приёма данных извне (решение 145, ТЗ функц. требования п.5).
 *
 * Машинная: заголовок `Authorization: Bearer <INTEGRATION_TOKEN>`, без cookie
 * сессии. Сравнение — постоянным временем (`timingSafeEqual`): обычное `===`
 * у строк останавливается на первом несовпадающем символе, и по времени ответа
 * можно по одному байту подобрать токен.
 */

const BEARER_PREFIX = 'Bearer '

/** Сравнение постоянным временем: буферы разной длины сравнивать нельзя напрямую. */
function timingSafeEqualStrings(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8')
  const bufB = Buffer.from(b, 'utf8')
  if (bufA.length !== bufB.length) {
    // Сравнение с собой — чтобы время ответа не выдавало, что длины разошлись
    // уже на этом шаге.
    timingSafeEqual(bufA, bufA)
    return false
  }
  return timingSafeEqual(bufA, bufB)
}

/**
 * Токен не задан в окружении — 503 «интеграция не настроена» (это не авария и не
 * отказ в доступе, функции просто ещё нет). Токен задан, но не совпал или не
 * прислан — 401.
 */
export function assertIntegrationRequest(request: Request): void {
  const configured = process.env.INTEGRATION_TOKEN?.trim()
  if (!configured) {
    throw serviceUnavailable('Интеграция не настроена: не задан INTEGRATION_TOKEN')
  }

  const header = request.headers.get('authorization') ?? ''
  const provided = header.startsWith(BEARER_PREFIX) ? header.slice(BEARER_PREFIX.length).trim() : ''
  if (!provided || !timingSafeEqualStrings(provided, configured)) {
    throw unauthorized('Неверный или отсутствующий токен интеграции')
  }
}
