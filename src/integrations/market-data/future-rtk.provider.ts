import { integrationError } from '@/shared/http/errors'
import type {
  MarketDataProvider,
  MarketDataProviderInfo,
  MarketDemandRecord,
} from './provider'

/**
 * Заготовка под будущую интеграцию с системами заказчика.
 *
 * Наличие конкретных внутренних API РТК не утверждается (решение 13 и раздел 14 ТЗ):
 * пока спецификация не предоставлена, провайдер честно сообщает, что не настроен,
 * и ничего не выдумывает.
 */
export class FutureRtkMarketDataProvider implements MarketDataProvider {
  info(): MarketDataProviderInfo {
    return {
      kind: 'future-rtk',
      name: 'Источник данных заказчика (спецификация не предоставлена)',
      ready: false,
      reason:
        'Интеграция описана спецификацией, но API заказчика не предоставлено. ' +
        'Подключение — после согласования параметров.',
      isMock: false,
    }
  }

  async fetchDemand(): Promise<MarketDemandRecord[]> {
    throw integrationError(
      'Источник данных заказчика не подключён: API не предоставлено. ' +
        'Выберите другой MARKET_DATA_PROVIDER.',
    )
  }
}
