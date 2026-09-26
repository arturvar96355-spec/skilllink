import { describe, expect, it } from 'vitest'
import {
  compareMigrations,
  publicLiveness,
  publicReadiness,
  type LivenessReport,
  type ReadinessReport,
} from './report'
import { latestMigrationIn } from '@/shared/ops/migrations'

const TIME = '2026-09-25T10:00:00.000Z'
const M1 = '20260925200000_telegram_links'
const M2 = '20260925230200_contact_legal_basis'

const authFailed: ReadinessReport = {
  status: 'degraded',
  reason: 'database-unavailable',
  database: 'auth-failed',
  schema: 'unknown',
  migration: { applied: null, expected: M2 },
  latencyMs: null,
  hint: 'База отвергла пароль. В DATABASE_URL он не тот…',
  time: TIME,
}

describe('ответ проверки готовности', () => {
  it('вне продакшена называет причину и совет', () => {
    expect(publicReadiness(authFailed, false)).toEqual(authFailed)
  })

  it('в продакшене не выдаёт подробностей настройки, но код причины оставляет', () => {
    // На стенде этот ответ видит любой: «база отвергла пароль» — подсказка тому,
    // кто ищет, что сломано. Код причины нужен сторожу и проверке после выкладки.
    const shown = publicReadiness(authFailed, true)
    expect(shown).toEqual({
      status: 'degraded',
      reason: 'database-unavailable',
      database: 'unavailable',
      schema: 'unknown',
      migration: { applied: null, expected: M2 },
      latencyMs: null,
      time: TIME,
    })
    expect(JSON.stringify(shown)).not.toContain('пароль')
  })

  it('в продакшене не отличает «не настроено» от «сломано»', () => {
    const misconfigured: ReadinessReport = { ...authFailed, status: 'misconfigured', reason: 'misconfigured', database: 'unknown' }
    expect(publicReadiness(misconfigured, true)).toMatchObject({ status: 'degraded', database: 'unknown' })
  })

  it('здоровый ответ одинаков везде — на него смотрят check.sh и сторож', () => {
    const healthy: ReadinessReport = {
      status: 'ok',
      database: 'connected',
      schema: 'ready',
      migration: { applied: M2, expected: M2 },
      latencyMs: 1.2,
      time: TIME,
    }
    expect(publicReadiness(healthy, true)).toEqual(healthy)
    expect(publicReadiness(healthy, false)).toEqual(healthy)
  })
})

describe('ответ проверки живости', () => {
  it('в продакшене без совета', () => {
    const secretMissing: LivenessReport = { status: 'misconfigured', uptimeSeconds: 3, hint: 'Не задан AUTH_SECRET', time: TIME }
    expect(publicLiveness(secretMissing, true)).toEqual({ status: 'degraded', uptimeSeconds: 3, time: TIME })
    expect(publicLiveness(secretMissing, false)).toEqual(secretMissing)
  })
})

describe('сверка миграций с кодом', () => {
  it('совпали — готово', () => {
    expect(compareMigrations({ latestApplied: M2, failed: null }, M2)).toEqual({ ok: true, schema: 'ready' })
  })

  it('в коде новее — не применены', () => {
    expect(compareMigrations({ latestApplied: M1, failed: null }, M2)).toMatchObject({ ok: false, reason: 'migrations-pending' })
  })

  it('в базе новее — код старше схемы: готово, но с пометкой (иначе откат кода невозможен)', () => {
    expect(compareMigrations({ latestApplied: M2, failed: null }, M1)).toMatchObject({ ok: true, schema: 'ahead' })
  })

  it('миграция упала посреди — не готово, даже если последняя совпала', () => {
    expect(compareMigrations({ latestApplied: M2, failed: M2 }, M2)).toMatchObject({ ok: false, reason: 'migration-failed' })
  })

  it('пустая база — миграции не применены', () => {
    expect(compareMigrations({ latestApplied: null, failed: null }, M2)).toMatchObject({ ok: false, reason: 'migrations-missing' })
  })

  it('каталога миграций нет — сверять не с чем, но применены ли они вообще, проверяется', () => {
    expect(compareMigrations({ latestApplied: M1, failed: null }, null)).toEqual({ ok: true, schema: 'ready' })
    expect(compareMigrations({ latestApplied: null, failed: null }, null)).toMatchObject({ ok: false })
  })

  it('последняя миграция в коде — по метке времени, служебные файлы не в счёт', () => {
    expect(latestMigrationIn([M2, 'migration_lock.toml', M1, '.DS_Store'])).toBe(M2)
    expect(latestMigrationIn(['migration_lock.toml'])).toBeNull()
  })
})
