import { METRICS_PATH } from '@/shared/config/metrics.config'
import { countSafely } from '@/shared/metrics/app-metrics'
import { routeTemplate } from '@/shared/metrics/routes'

/**
 * Учёт запроса в метриках (решение 137): число запросов и время ответа
 * по методу и **шаблону** маршрута.
 *
 * Стоит снаружи ограничения частоты (handle.ts): отказ 429 — тоже ответ,
 * и всплеск отказов должен быть виден. Сама выдача метрик не считается —
 * иначе каждый опрос Prometheus менял бы то, что он измеряет.
 *
 * Время — до того, как обработчик вернул ответ: передачу тела (потоковую
 * выгрузку) оно не включает.
 */

const KNOWN_METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'])

export function statusClass(status: number): string {
  if (status >= 100 && status < 600) return `${Math.floor(status / 100)}xx`
  return 'other'
}

function record(request: Request, status: number, seconds: number): void {
  countSafely((metrics) => {
    const pathname = new URL(request.url).pathname
    const route = routeTemplate(pathname)
    if (route === METRICS_PATH) return
    const upper = request.method.toUpperCase()
    const method = KNOWN_METHODS.has(upper) ? upper : 'OTHER'
    metrics.httpRequests.inc({ method, route, status_class: statusClass(status) })
    metrics.httpDuration.observe(seconds, { method, route })
  })
}

export function withMetrics<Req extends Request, Args extends unknown[]>(
  fn: (request: Req, ...rest: Args) => Promise<Response> | Response,
): (request: Req, ...rest: Args) => Promise<Response> {
  return async (request, ...rest) => {
    const started = performance.now()
    // Исключение из обработчика — 500 для клиента (Next отвечает сам).
    let status = 500
    try {
      const response = await fn(request, ...rest)
      status = response.status
      return response
    } finally {
      record(request, status, (performance.now() - started) / 1000)
    }
  }
}
