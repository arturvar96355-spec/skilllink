/**
 * Настройки интеграций. Всё берётся из переменных окружения — в коде секретов нет.
 *
 * По умолчанию интеграции выключены (решение 13): система должна работать без них,
 * а их сбой не должен ломать основной контур.
 */

function readBoolean(name: string, fallback = false): boolean {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  return raw === 'true' || raw === '1'
}

function readNumber(name: string, fallback: number): number {
  const raw = Number(process.env[name])
  return Number.isFinite(raw) && raw > 0 ? raw : fallback
}

function readString(name: string): string | null {
  const raw = process.env[name]
  return raw === undefined || raw.trim() === '' ? null : raw.trim()
}

/** Какой источник рыночных данных активен (решение 12). */
export const MARKET_DATA_PROVIDERS = ['mock', 'csv', 'external-api', 'future-rtk'] as const
export type MarketDataProviderKind = (typeof MARKET_DATA_PROVIDERS)[number]

function readProviderKind(): MarketDataProviderKind {
  const raw = readString('MARKET_DATA_PROVIDER') ?? 'mock'
  return (MARKET_DATA_PROVIDERS as readonly string[]).includes(raw)
    ? (raw as MarketDataProviderKind)
    : 'mock'
}

export interface IntegrationCommonConfig {
  timeoutMs: number
  retries: number
  /** Минимальный интервал между запросами к одному внешнему сервису, мс. */
  minIntervalMs: number
}

export interface RemoteServiceConfig {
  enabled: boolean
  baseUrl: string | null
  token: string | null
}

export interface IntegrationsConfig {
  common: IntegrationCommonConfig
  marketData: {
    kind: MarketDataProviderKind
    csvPath: string | null
    apiUrl: string | null
    apiToken: string | null
  }
  lms: RemoteServiceConfig
  site: RemoteServiceConfig
}

/**
 * Читается при каждом обращении, а не один раз на импорт: так переменные окружения
 * можно поменять без пересборки, а тесты не зависят от порядка импортов.
 */
export function getIntegrationsConfig(): IntegrationsConfig {
  return {
    common: {
      timeoutMs: readNumber('INTEGRATION_TIMEOUT_MS', 5000),
      retries: readNumber('INTEGRATION_RETRIES', 2),
      minIntervalMs: readNumber('INTEGRATION_MIN_INTERVAL_MS', 200),
    },
    marketData: {
      kind: readProviderKind(),
      csvPath: readString('MARKET_DATA_CSV_PATH'),
      apiUrl: readString('MARKET_DATA_API_URL'),
      apiToken: readString('MARKET_DATA_API_TOKEN'),
    },
    lms: {
      enabled: readBoolean('LMS_ENABLED'),
      baseUrl: readString('LMS_API_URL'),
      token: readString('LMS_API_TOKEN'),
    },
    site: {
      enabled: readBoolean('SITE_ENABLED'),
      baseUrl: readString('SITE_API_URL'),
      token: readString('SITE_API_TOKEN'),
    },
  }
}
