/**
 * Ответ проверки живости — подробный или сдержанный.
 *
 * Подробный называет причину и совет: «не задан AUTH_SECRET», «база отвергла
 * пароль», «такой базы нет». Разработчику у себя это экономит час, но на стенде
 * тот же ответ видит любой прохожий — и узнаёт, что именно сломано в настройке.
 *
 * В продакшене наружу уходят только состояния, по которым работают проверки
 * (`status`, `schema` — на них смотрят scripts/deploy/check.sh и Docker), а база
 * называется просто недоступной. Подсказка пишется в журнал приложения: оператор
 * читает её в `docker compose logs app` — туда же смотрит remote-up.sh при сбое.
 */
export interface HealthReport {
  status: 'ok' | 'degraded' | 'misconfigured'
  database: string
  schema: 'ready' | 'missing' | 'unknown'
  hint?: string
  time: string
}

export interface PublicHealth {
  status: HealthReport['status']
  database: string
  schema: HealthReport['schema']
  hint?: string
  time: string
}

/** Состояния базы, которые ничего не говорят о настройке. */
const NEUTRAL_DATABASE_STATES = new Set(['connected', 'unknown'])

export function publicHealth(report: HealthReport, production: boolean): PublicHealth {
  if (!production) return report

  const database = NEUTRAL_DATABASE_STATES.has(report.database) ? report.database : 'unavailable'
  // «misconfigured» — уже подсказка: снаружи достаточно знать, что стенд нездоров.
  const status = report.status === 'misconfigured' ? 'degraded' : report.status
  return { status, database, schema: report.schema, time: report.time }
}
