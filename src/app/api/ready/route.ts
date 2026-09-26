import { prisma } from '@/shared/db/prisma'
import { diagnoseDatabaseError } from '@/shared/db/database-error'
import { latestMigrationInCode } from '@/shared/ops/migrations'
import {
  compareMigrations,
  publicReadiness,
  type AppliedMigrations,
  type ReadinessReport,
} from '../health/report'
import { handle, ok } from '@/shared/http'

/**
 * Проверка готовности: можно ли обслуживать запросы (решение 118).
 *
 * - база отвечает на `SELECT 1` — время ответа в `latencyMs`;
 * - последняя применённая миграция совпадает с последней в `prisma/migrations`
 *   запущенного образа, и нет начатой и не законченной. В базе новее, чем в коде
 *   (откат кода), — 200 со `schema: 'ahead'`: почему не 503 — report.ts.
 *
 * Иначе 503 `{ status: 'degraded', reason }`. На неё смотрят проверка после выкладки
 * (remote-up.sh, check.sh), сторож (scripts/ops/watchdog.sh) и «Стенд жив».
 * Healthcheck контейнера смотрит на `/api/health`: падение базы не должно
 * перезапускать приложение, оно само вернётся в строй вместе с базой.
 *
 * Причина сбоя называется всегда (`reason`), подробный совет — только вне продакшена.
 */
export const dynamic = 'force-dynamic'

interface MigrationRow {
  migration_name: string
  finished_at: Date | null
  rolled_back_at: Date | null
}

export const GET = handle(async () => {
  const production = process.env.NODE_ENV === 'production'
  const expected = latestMigrationInCode()
  const base = { migration: { applied: null, expected }, latencyMs: null, time: new Date().toISOString() }

  const respond = (report: ReadinessReport) => {
    if (report.hint && production) console.error('Проверка готовности:', report.hint)
    return ok(publicReadiness(report, production), report.status === 'ok' ? 200 : 503)
  }

  if ((production && !process.env.AUTH_SECRET?.trim()) || !process.env.DATABASE_URL) {
    return respond({
      status: 'misconfigured',
      reason: 'misconfigured',
      database: process.env.DATABASE_URL ? 'unknown' : 'not-configured',
      schema: 'unknown',
      ...base,
      hint: 'Не задан AUTH_SECRET или DATABASE_URL — подробности в /api/health.',
    })
  }

  const started = performance.now()
  try {
    await prisma.$queryRaw`SELECT 1`
  } catch (error) {
    console.error('Проверка готовности: база не ответила', error)
    const { database, hint } = diagnoseDatabaseError(error)
    return respond({ status: 'degraded', reason: 'database-unavailable', database, schema: 'unknown', ...base, hint })
  }
  const latencyMs = Math.round((performance.now() - started) * 10) / 10

  let applied: AppliedMigrations
  try {
    // Таблицу ведёт Prisma; роль приложения читает её (create-app-role.sql, шаг 6).
    const rows = await prisma.$queryRaw<MigrationRow[]>`
      SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations`
    const done = rows.filter((row) => row.finished_at !== null && row.rolled_back_at === null)
    const failed = rows.find((row) => row.finished_at === null && row.rolled_back_at === null)
    applied = {
      latestApplied: done.map((row) => row.migration_name).sort().at(-1) ?? null,
      failed: failed?.migration_name ?? null,
    }
  } catch {
    // Таблицы миграций нет — база пустая.
    applied = { latestApplied: null, failed: null }
  }

  const verdict = compareMigrations(applied, expected)
  const migration = { applied: applied.latestApplied, expected }
  if (!verdict.ok) {
    return respond({
      status: 'degraded',
      reason: verdict.reason,
      database: 'connected',
      schema: verdict.reason === 'migrations-missing' ? 'missing' : 'mismatch',
      ...base,
      migration,
      latencyMs,
      hint: verdict.hint,
    })
  }

  return respond({
    status: 'ok',
    database: 'connected',
    schema: verdict.schema,
    ...base,
    migration,
    latencyMs,
    ...(verdict.hint ? { hint: verdict.hint } : {}),
  })
})
