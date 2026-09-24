import { describe, expect, it } from 'vitest'
import { publicHealth, type HealthReport } from './report'

const TIME = '2026-09-25T10:00:00.000Z'

const authFailed: HealthReport = {
  status: 'degraded',
  database: 'auth-failed',
  schema: 'unknown',
  hint: 'База отвергла пароль. В DATABASE_URL он не тот…',
  time: TIME,
}

describe('ответ проверки живости', () => {
  it('вне продакшена называет причину и совет', () => {
    expect(publicHealth(authFailed, false)).toEqual(authFailed)
  })

  it('в продакшене не выдаёт подробностей настройки', () => {
    // На стенде этот ответ видит любой: «база отвергла пароль» или «не задан
    // AUTH_SECRET» — подсказка тому, кто ищет, что сломано.
    const shown = publicHealth(authFailed, true)
    expect(shown).toEqual({ status: 'degraded', database: 'unavailable', schema: 'unknown', time: TIME })
    expect(JSON.stringify(shown)).not.toContain('пароль')
  })

  it('в продакшене не отличает «не настроено» от «сломано»', () => {
    const secretMissing: HealthReport = {
      status: 'misconfigured',
      database: 'unknown',
      schema: 'unknown',
      hint: 'Не задан AUTH_SECRET',
      time: TIME,
    }
    expect(publicHealth(secretMissing, true)).toEqual({
      status: 'degraded',
      database: 'unknown',
      schema: 'unknown',
      time: TIME,
    })
  })

  it('здоровый ответ одинаков везде — на него смотрят check.sh и Docker', () => {
    const healthy: HealthReport = { status: 'ok', database: 'connected', schema: 'ready', time: TIME }
    expect(publicHealth(healthy, true)).toEqual(healthy)
    expect(publicHealth(healthy, false)).toEqual(healthy)
  })

  it('неприменённые миграции видны и в продакшене, но без совета', () => {
    const missing: HealthReport = {
      status: 'degraded',
      database: 'connected',
      schema: 'missing',
      hint: 'Примените миграции: npm run db:deploy',
      time: TIME,
    }
    expect(publicHealth(missing, true)).toEqual({
      status: 'degraded',
      database: 'connected',
      schema: 'missing',
      time: TIME,
    })
  })
})
