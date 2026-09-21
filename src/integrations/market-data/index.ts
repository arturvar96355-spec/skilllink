import { getIntegrationsConfig } from '../config'
import { CsvMarketDataProvider } from './csv.provider'
import { ExternalApiMarketDataProvider } from './external-api.provider'
import { FutureRtkMarketDataProvider } from './future-rtk.provider'
import { MockMarketDataProvider } from './mock.provider'
import type { MarketDataProvider } from './provider'

export * from './provider'
export { MockMarketDataProvider } from './mock.provider'
export { CsvMarketDataProvider } from './csv.provider'
export { ExternalApiMarketDataProvider } from './external-api.provider'
export { FutureRtkMarketDataProvider } from './future-rtk.provider'

/**
 * Активный источник рыночных данных выбирается переменной MARKET_DATA_PROVIDER.
 * Бизнес-логика вызывает только интерфейс и о конкретной реализации не знает.
 */
export function getMarketDataProvider(): MarketDataProvider {
  const config = getIntegrationsConfig()

  switch (config.marketData.kind) {
    case 'csv':
      return new CsvMarketDataProvider(config.marketData.csvPath)
    case 'external-api':
      return new ExternalApiMarketDataProvider(
        config.marketData.apiUrl,
        config.marketData.apiToken,
        config.common,
      )
    case 'future-rtk':
      return new FutureRtkMarketDataProvider()
    case 'mock':
    default:
      return new MockMarketDataProvider()
  }
}
