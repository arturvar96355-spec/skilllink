/**
 * Источник рыночных данных: демонстрационный набор, CSV, внешний API или системы заказчика.
 *
 * Бизнес-логика знает только этот интерфейс. Заменить демонстрационный набор
 * реальным API можно, не переписывая ни одного сервиса.
 */
export interface MarketDemandRecord {
  /** Название навыка. Сопоставление с справочником — забота вызывающего кода. */
  skillName: string
  /** Период вида 2026-Q1 или 2026-03. */
  period: string
  value: number
  unit: string
  region: string | null
  /** Человекочитаемое имя источника: попадает в таблицу и в ответы API. */
  source: string
  confidence: 'LOW' | 'MEDIUM' | 'HIGH'
  /** Демонстрационные данные. Выдавать их за подтверждённую статистику запрещено. */
  isMock: boolean
}

export interface MarketDataProviderInfo {
  kind: string
  name: string
  /** Готов ли провайдер к работе: настроен ли путь, адрес, токен. */
  ready: boolean
  /** Чего не хватает, если не готов. */
  reason: string | null
  isMock: boolean
}

export interface MarketDataProvider {
  info(): MarketDataProviderInfo
  fetchDemand(period?: string): Promise<MarketDemandRecord[]>
}
