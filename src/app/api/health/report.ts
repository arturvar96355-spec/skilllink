/**
 * Ответы проверок живости (`/api/health`) и готовности (`/api/ready`) — подробные
 * или сдержанные (решение 118).
 *
 * Живость — «процесс жив и настроен»: без базы. На неё смотрит healthcheck
 * контейнера, и падение базы не должно делать приложение «нездоровым» — иначе
 * Caddy при пересоздании не дождался бы приложения, а сторож перезапускал бы то,
 * что само заработает, когда вернётся база.
 *
 * Готовность — «можно обслуживать запросы»: база отвечает, и последняя применённая
 * миграция — та же, что последняя в коде. На неё смотрят проверка после выкладки,
 * сторож и «Стенд жив».
 *
 * Подробный ответ называет причину и совет: «не задан AUTH_SECRET», «база отвергла
 * пароль». Разработчику у себя это экономит час, но на стенде тот же ответ видит
 * любой прохожий. В продакшене наружу уходят только состояния, по которым работают
 * проверки (`status`, `schema`, `reason`), а база называется просто недоступной.
 * Подсказка пишется в журнал приложения: оператор читает её в `docker compose logs app`.
 */

// ── Живость ──────────────────────────────────────────────────────────────────

export interface LivenessReport {
  status: 'ok' | 'misconfigured'
  /** Сколько секунд работает процесс: после падения и перезапуска — снова с нуля. */
  uptimeSeconds: number
  hint?: string
  time: string
}

export interface PublicLiveness {
  status: 'ok' | 'degraded' | 'misconfigured'
  uptimeSeconds: number
  hint?: string
  time: string
}

export function publicLiveness(report: LivenessReport, production: boolean): PublicLiveness {
  if (!production) return report
  // «misconfigured» — уже подсказка: снаружи достаточно знать, что процесс нездоров.
  return {
    status: report.status === 'misconfigured' ? 'degraded' : report.status,
    uptimeSeconds: report.uptimeSeconds,
    time: report.time,
  }
}

// ── Готовность ───────────────────────────────────────────────────────────────

/**
 * Почему не готово. Код, а не текст: по нему работают скрипты и сторож.
 * - `misconfigured` — не задан AUTH_SECRET или DATABASE_URL;
 * - `database-unavailable` — база не ответила на `SELECT 1`;
 * - `migrations-missing` — таблицы миграций нет: база пустая;
 * - `migration-failed` — миграция начата и не закончена (упала посреди);
 * - `migrations-pending` — в коде есть миграции новее применённой.
 *
 * Обратный случай — в базе миграция, которой в коде нет (код откатили на версию до
 * миграции), — не «не готово»: ответ 200 со `schema: 'ahead'`. Откат кода — штатная
 * операция, миграции проекта только добавляют; 503 на нём сделал бы откат
 * невозможным (проверка после выкладки его отвергла бы). Сторож сообщает о таком
 * расхождении предупреждением.
 */
export type ReadinessReason =
  | 'misconfigured'
  | 'database-unavailable'
  | 'migrations-missing'
  | 'migration-failed'
  | 'migrations-pending'

export interface ReadinessReport {
  status: 'ok' | 'degraded' | 'misconfigured'
  reason?: ReadinessReason
  database: string
  /**
   * `ready` — миграции совпадают; `ahead` — в базе новее, чем в коде (после отката кода);
   * `missing` — не применены; `mismatch` — в коде новее или миграция упала посреди.
   */
  schema: 'ready' | 'ahead' | 'missing' | 'mismatch' | 'unknown'
  migration: { applied: string | null; expected: string | null }
  /** Время ответа базы на `SELECT 1`, мс. null — до базы не дошло. */
  latencyMs: number | null
  hint?: string
  time: string
}

export type PublicReadiness = Omit<ReadinessReport, 'status'> & { status: 'ok' | 'degraded' }

/** Состояния базы, которые ничего не говорят о настройке. */
const NEUTRAL_DATABASE_STATES = new Set(['connected', 'unknown'])

export function publicReadiness(report: ReadinessReport, production: boolean): PublicReadiness | ReadinessReport {
  if (!production) return report
  const { hint: _hint, ...rest } = report
  return {
    ...rest,
    status: report.status === 'misconfigured' ? 'degraded' : report.status,
    database: NEUTRAL_DATABASE_STATES.has(report.database) ? report.database : 'unavailable',
  }
}

export interface AppliedMigrations {
  /** Последняя успешно применённая (по имени: имена начинаются с метки времени). */
  latestApplied: string | null
  /** Начатая и не законченная миграция, если есть. */
  failed: string | null
}

export type MigrationVerdict =
  | { ok: true; schema: 'ready' | 'ahead'; hint?: string }
  | { ok: false; reason: 'migration-failed' | 'migrations-pending' | 'migrations-missing'; hint: string }

/**
 * Совпадает ли схема базы с кодом.
 *
 * `expected` — последняя миграция в `prisma/migrations` того образа, что запущен.
 * null — каталога нет (приложение запущено не из корня проекта): сравнить не с чем,
 * и это не повод объявлять стенд неготовым — остаётся проверка, что миграции вообще
 * применены.
 */
export function compareMigrations(applied: AppliedMigrations, expected: string | null): MigrationVerdict {
  if (applied.failed) {
    return {
      ok: false,
      reason: 'migration-failed',
      hint: `Миграция ${applied.failed} начата и не закончена. Разберитесь по журналу migrate и повторите npm run db:deploy.`,
    }
  }
  if (applied.latestApplied === null) {
    return { ok: false, reason: 'migrations-missing', hint: 'Примените миграции: npm run db:deploy' }
  }
  if (expected === null || applied.latestApplied === expected) return { ok: true, schema: 'ready' }
  if (applied.latestApplied < expected) {
    return {
      ok: false,
      reason: 'migrations-pending',
      hint: `Не применены миграции новее ${applied.latestApplied}. Примените: npm run db:deploy`,
    }
  }
  return {
    ok: true,
    schema: 'ahead',
    hint: `В базе миграция ${applied.latestApplied}, которой нет в коде: код старше схемы (откат). Когда исправление готово — разверните код, в котором она есть.`,
  }
}
