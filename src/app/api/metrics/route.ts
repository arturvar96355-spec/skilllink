import { handle } from '@/shared/http'
import { notFound, unauthorized } from '@/shared/http/errors'
import { metricsAccess } from '@/shared/metrics/access'
import { appMetrics } from '@/shared/metrics/app-metrics'
import { PROMETHEUS_CONTENT_TYPE } from '@/shared/metrics/registry'

/**
 * Метрики сервера в текстовом формате Prometheus (решение 137).
 *
 * Доступ — по токену `METRICS_TOKEN` или с самой машины приложения
 * (shared/metrics/access.ts); снаружи адрес закрыт в Caddy. Не ограничивается
 * по частоте и сам в метрики не попадает. При каждом запросе проверяется база
 * (`SELECT 1` с таймаутом) и читается отметка ночной копии.
 */
export const GET = handle(async (request) => {
  const access = metricsAccess(request)
  if (access === 'disabled') throw notFound('Такого адреса в API нет')
  if (access === 'unauthorized') throw unauthorized('Нужен токен метрик: заголовок Authorization: Bearer …')

  const body = await appMetrics().registry.collect()
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': PROMETHEUS_CONTENT_TYPE, 'Cache-Control': 'no-store' },
  })
})
