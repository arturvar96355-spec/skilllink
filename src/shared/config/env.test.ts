import { describe, expect, it } from 'vitest'
import { authSecretProblem, checkEnvironment, shouldCheckEnvironment } from './env'

const GOOD_SECRET = 'q7Zr1bVx0pLm3Ns8Tt5Yw2Ke9Hd4Gf6Aa1Bc2De3Ff='
const DB = 'postgresql://skilllink:pw@localhost:5432/skilllink?schema=public'

describe('проверка окружения при старте (решение 123)', () => {
  it('годное окружение — без ошибок', () => {
    expect(checkEnvironment({ AUTH_SECRET: GOOD_SECRET, DATABASE_URL: DB, AUTH_URL: 'https://x.test' })).toEqual({
      errors: [],
      warnings: [],
    })
  })

  it('секрет: пустой, короткий, запасной из кода, из повторов — отказ', () => {
    expect(authSecretProblem(undefined)).toMatch(/не задан/)
    expect(authSecretProblem('   ')).toMatch(/не задан/)
    expect(authSecretProblem('short-secret')).toMatch(/короче 32/)
    // Значение из CI до решения 123 — короткое, в промышленном режиме не годится.
    expect(authSecretProblem('ci-secret-not-for-production')).toMatch(/короче/)
    expect(authSecretProblem('skilllink-dev-secret-not-for-production')).toMatch(/запасным значением/)
    expect(authSecretProblem('ab'.repeat(20))).toMatch(/повторяющихся/)
    expect(authSecretProblem(GOOD_SECRET)).toBeNull()
  })

  it('нет базы или адрес не postgres — отказ', () => {
    expect(checkEnvironment({ AUTH_SECRET: GOOD_SECRET }).errors).toEqual(['не задан DATABASE_URL'])
    expect(checkEnvironment({ AUTH_SECRET: GOOD_SECRET, DATABASE_URL: 'mysql://x' }).errors).toHaveLength(1)
  })

  it('обе ошибки сразу — по строке на каждую', () => {
    expect(checkEnvironment({}).errors).toEqual(['не задан AUTH_SECRET', 'не задан DATABASE_URL'])
  })

  it('необязательное настроено наполовину — предупреждение, не отказ', () => {
    const report = checkEnvironment({
      AUTH_SECRET: GOOD_SECRET,
      DATABASE_URL: DB,
      TELEGRAM_BOT_TOKEN: 'x',
      TELEGRAM_WEBHOOK_SECRET: 'bad secret!',
      AI_ASSIST_PROVIDER: 'yandexgpt',
      DEMO_AUTH_ENABLED: 'true',
    })
    expect(report.errors).toEqual([])
    expect(report.warnings.join('\n')).toMatch(/TELEGRAM_BOT_USERNAME/)
    expect(report.warnings.join('\n')).toMatch(/1–256 знаков/)
    expect(report.warnings.join('\n')).toMatch(/YANDEX_GPT_API_KEY/)
    expect(report.warnings.join('\n')).toMatch(/DEMO_AUTH_ENABLED/)
    // Значения секретов в предупреждения не попадают.
    expect(report.warnings.join('\n')).not.toContain('bad secret!')
  })

  it('проверяется только промышленный сервер: не сборка, не разработка', () => {
    expect(shouldCheckEnvironment({ NODE_ENV: 'production' })).toBe(true)
    expect(shouldCheckEnvironment({ NODE_ENV: 'production', NEXT_PHASE: 'phase-production-build' })).toBe(false)
    expect(shouldCheckEnvironment({ NODE_ENV: 'development' })).toBe(false)
    expect(shouldCheckEnvironment({ NODE_ENV: 'test' })).toBe(false)
  })
})
