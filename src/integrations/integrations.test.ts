import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AppError } from '@/shared/http/errors'
import { getIntegrationsConfig } from './config'
import { getMarketDataProvider } from './market-data'
import { CsvMarketDataProvider } from './market-data/csv.provider'
import { FutureRtkMarketDataProvider } from './market-data/future-rtk.provider'
import { MockMarketDataProvider } from './market-data/mock.provider'
import { getLmsClient } from './lms/lms.client'
import { getSiteClient } from './site/site.client'

/** Переменные окружения восстанавливаются после каждого теста. */
const TOUCHED = [
  'MARKET_DATA_PROVIDER',
  'MARKET_DATA_CSV_PATH',
  'MARKET_DATA_API_URL',
  'LMS_ENABLED',
  'LMS_API_URL',
  'SITE_ENABLED',
  'SITE_API_URL',
  'INTEGRATION_TIMEOUT_MS',
  'INTEGRATION_RETRIES',
]

let saved: Record<string, string | undefined> = {}

beforeEach(() => {
  saved = Object.fromEntries(TOUCHED.map((name) => [name, process.env[name]]))
  for (const name of TOUCHED) delete process.env[name]
})

afterEach(() => {
  for (const name of TOUCHED) {
    const value = saved[name]
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
})

async function expectAppError(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(AppError)
    expect((error as AppError).code).toBe(code)
    return
  }
  throw new Error(`Ожидалась ошибка ${code}, но её не было`)
}

describe('настройки интеграций', () => {
  it('по умолчанию интеграции выключены', () => {
    const config = getIntegrationsConfig()
    expect(config.lms.enabled).toBe(false)
    expect(config.site.enabled).toBe(false)
  })

  it('по умолчанию активен демонстрационный источник', () => {
    expect(getIntegrationsConfig().marketData.kind).toBe('mock')
  })

  it('неизвестное значение провайдера не ломает систему, а откатывается к демо', () => {
    process.env.MARKET_DATA_PROVIDER = 'что-то-не-то'
    expect(getIntegrationsConfig().marketData.kind).toBe('mock')
  })

  it('читает таймаут и число повторов', () => {
    process.env.INTEGRATION_TIMEOUT_MS = '1500'
    process.env.INTEGRATION_RETRIES = '4'
    const config = getIntegrationsConfig()
    expect(config.common.timeoutMs).toBe(1500)
    expect(config.common.retries).toBe(4)
  })

  it('мусор в числовой переменной не обнуляет таймаут', () => {
    process.env.INTEGRATION_TIMEOUT_MS = 'abc'
    expect(getIntegrationsConfig().common.timeoutMs).toBe(5000)
  })

  it('включает интеграцию только при явном true', () => {
    process.env.LMS_ENABLED = 'true'
    expect(getIntegrationsConfig().lms.enabled).toBe(true)
    process.env.LMS_ENABLED = 'false'
    expect(getIntegrationsConfig().lms.enabled).toBe(false)
  })
})

describe('выбор источника рыночных данных', () => {
  it('по умолчанию демонстрационный', () => {
    expect(getMarketDataProvider()).toBeInstanceOf(MockMarketDataProvider)
  })

  it('csv выбирается переменной окружения', () => {
    process.env.MARKET_DATA_PROVIDER = 'csv'
    expect(getMarketDataProvider()).toBeInstanceOf(CsvMarketDataProvider)
  })

  it('заготовка под системы заказчика выбирается, но честно сообщает о неготовности', () => {
    process.env.MARKET_DATA_PROVIDER = 'future-rtk'
    const provider = getMarketDataProvider()
    expect(provider).toBeInstanceOf(FutureRtkMarketDataProvider)
    expect(provider.info().ready).toBe(false)
    expect(provider.info().reason).toContain('не предоставлено')
  })
})

describe('демонстрационный источник', () => {
  const provider = new MockMarketDataProvider()

  it('помечает себя как демонстрационный', () => {
    expect(provider.info().isMock).toBe(true)
    expect(provider.info().ready).toBe(true)
  })

  it('отдаёт записи с происхождением', async () => {
    const records = await provider.fetchDemand()
    expect(records.length).toBeGreaterThan(0)
    expect(records.every((record) => record.source.length > 0)).toBe(true)
    expect(records.every((record) => record.isMock)).toBe(true)
    expect(records.every((record) => record.confidence === 'LOW')).toBe(true)
  })

  it('отдаёт данные за запрошенный период', async () => {
    const records = await provider.fetchDemand('2025-Q4')
    expect(records.every((record) => record.period === '2025-Q4')).toBe(true)
  })
})

describe('источник из CSV', () => {
  it('без пути сообщает, чего не хватает', () => {
    const provider = new CsvMarketDataProvider(null)
    expect(provider.info().ready).toBe(false)
    expect(provider.info().reason).toContain('MARKET_DATA_CSV_PATH')
  })

  it('без пути отдаёт ошибку интеграции, а не падает', async () => {
    await expectAppError(new CsvMarketDataProvider(null).fetchDemand(), 'INTEGRATION_ERROR')
  })

  it('несуществующий файл — ошибка интеграции', async () => {
    const provider = new CsvMarketDataProvider('/nonexistent/market-data.csv')
    await expectAppError(provider.fetchDemand(), 'INTEGRATION_ERROR')
  })

  it('разбирает файл и пропускает битые строки', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'skilllink-csv-'))
    const path = join(dir, 'demand.csv')
    await writeFile(
      path,
      [
        'skill,period,value,unit,region,source,confidence',
        'Python,2026-Q1,9400,вакансий,Россия,Выгрузка,HIGH',
        'SQL,2026-Q1,9600,вакансий,Россия,Выгрузка,MEDIUM',
        'Битая строка,2026-Q1,не-число,вакансий,Россия,Выгрузка,LOW',
        '',
      ].join('\n'),
      'utf8',
    )

    const records = await new CsvMarketDataProvider(path).fetchDemand()
    expect(records).toHaveLength(2)
    expect(records[0]?.skillName).toBe('Python')
    expect(records[0]?.confidence).toBe('HIGH')
    // Данные подготовлены человеком, а не сгенерированы: демонстрационными не считаются.
    expect(records.every((record) => record.isMock)).toBe(false)
  })

  it('фильтрует по периоду', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'skilllink-csv-'))
    const path = join(dir, 'demand.csv')
    await writeFile(
      path,
      [
        'skill,period,value,unit,region,source,confidence',
        'Python,2026-Q1,9400,вакансий,Россия,Выгрузка,HIGH',
        'Python,2025-Q4,8200,вакансий,Россия,Выгрузка,HIGH',
      ].join('\n'),
      'utf8',
    )

    const records = await new CsvMarketDataProvider(path).fetchDemand('2025-Q4')
    expect(records).toHaveLength(1)
    expect(records[0]?.value).toBe(8200)
  })
})

describe('выключенные интеграции', () => {
  it('LMS выключена и сообщает почему', () => {
    const status = getLmsClient().status()
    expect(status.enabled).toBe(false)
    expect(status.reason).toContain('LMS_ENABLED')
  })

  it('обращение к выключенной LMS даёт ошибку интеграции, а не падение', async () => {
    await expectAppError(getLmsClient().fetchCourseProgress('course-1'), 'INTEGRATION_ERROR')
  })

  it('сайт выключен и сообщает почему', () => {
    const status = getSiteClient().status()
    expect(status.enabled).toBe(false)
    expect(status.reason).toContain('SITE_ENABLED')
  })

  it('обращение к выключенному сайту даёт ошибку интеграции', async () => {
    await expectAppError(getSiteClient().fetchApplications(), 'INTEGRATION_ERROR')
  })

  it('включённая без адреса интеграция остаётся в демонстрационном режиме', () => {
    process.env.LMS_ENABLED = 'true'
    // Адрес не задан — подключаться некуда, работаем как выключенные.
    expect(getLmsClient().status().enabled).toBe(false)
  })
})
