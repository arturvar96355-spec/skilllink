import { createHash, timingSafeEqual } from 'node:crypto'

/**
 * Кому можно читать метрики (решение 137).
 *
 * - **По токену**: `Authorization: Bearer <METRICS_TOKEN>`. Так ходит Prometheus
 *   из профиля `monitoring` — он в той же сети docker, но адрес у него свой.
 * - **С самой машины приложения**: последний адрес `X-Forwarded-For` — петлевой
 *   (127.0.0.1, ::1). Это `docker exec skilllink-app …` и `next start` на ноутбуке.
 *
 * Снаружи `/api/metrics` закрыт в Caddy (respond 404): через него запрос
 * не доходит вовсе, а свой `X-Forwarded-For` Caddy всё равно заменяет. Петлевой
 * адрес подделывается только прямым обращением к порту 3000 — он закрыт
 * снаружи, внутри сети docker и на самой машине — только наши контейнеры и
 * владелец (SECURITY_LIMITATIONS). В метриках нет персональных данных — только
 * счётчики по шаблонам маршрутов.
 *
 * Сравнение токена — по хешам и за постоянное время: по времени ответа
 * токен не подобрать посимвольно.
 */

export type MetricsAccess = 'allowed' | 'unauthorized' | 'disabled'

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])

/** Запрос пришёл с петлевого адреса (Next подставляет адрес соединения сам). */
export function isLoopback(headers: { get(name: string): string | null }): boolean {
  const last = headers.get('x-forwarded-for')?.split(',').at(-1)?.trim().toLowerCase()
  return last !== undefined && LOOPBACK.has(last.replace(/^\[|\]$/g, ''))
}

const digest = (value: string): Buffer => createHash('sha256').update(value).digest()

function tokenMatches(presented: string, expected: string): boolean {
  return timingSafeEqual(digest(presented), digest(expected))
}

/**
 * Решение о доступе. `disabled` — токен не задан и запрос не с этой машины:
 * для постороннего маршрута как будто нет (404). `unauthorized` — токен задан,
 * но не предъявлен или неверен (401).
 */
export function metricsAccess(request: Request, token: string | undefined = process.env.METRICS_TOKEN): MetricsAccess {
  if (isLoopback(request.headers)) return 'allowed'
  const expected = token?.trim() ?? ''
  if (expected === '') return 'disabled'
  const header = request.headers.get('authorization') ?? ''
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header)
  if (!match) return 'unauthorized'
  return tokenMatches(match[1]!, expected) ? 'allowed' : 'unauthorized'
}
