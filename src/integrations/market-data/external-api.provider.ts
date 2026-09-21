import { integrationError } from '@/shared/http/errors'
import { requestJson } from '../http-client'
import type { IntegrationCommonConfig } from '../config'
import type {
  MarketDataProvider,
  MarketDataProviderInfo,
  MarketDemandRecord,
} from './provider'

/** Ожидаемый формат ответа внешнего API. Проверяется перед использованием. */
interface ExternalDemandResponse {
  items?: Array<{
    skill?: string
    period?: string
    value?: number
    unit?: string
    region?: string
    confidence?: string
  }>
}

/**
 * Рыночные данные из внешнего HTTP API.
 * Адрес и токен берутся из переменных окружения, схема ответа проверяется.
 */
export class ExternalApiMarketDataProvider implements MarketDataProvider {
  constructor(
    private readonly baseUrl: string | null,
    private readonly token: string | null,
    private readonly common: IntegrationCommonConfig,
  ) {}

  info(): MarketDataProviderInfo {
    return {
      kind: 'external-api',
      name: 'Внешний источник рыночных данных',
      ready: this.baseUrl !== null,
      reason: this.baseUrl === null ? 'Не задан MARKET_DATA_API_URL' : null,
      isMock: false,
    }
  }

  async fetchDemand(period?: string): Promise<MarketDemandRecord[]> {
    if (!this.baseUrl) {
      throw integrationError('Внешний источник не настроен: не задан MARKET_DATA_API_URL')
    }

    const url = new URL(this.baseUrl)
    if (period) url.searchParams.set('period', period)

    const response = await requestJson<ExternalDemandResponse>({
      service: 'market-data',
      url: url.toString(),
      token: this.token,
      config: this.common,
    })

    if (!Array.isArray(response.items)) {
      throw integrationError('Внешний источник вернул ответ неожиданного формата')
    }

    // Записи с неполными данными отбрасываются: лучше меньше строк, чем мусор в аналитике.
    return response.items
      .filter(
        (item): item is { skill: string; period: string; value: number } & typeof item =>
          typeof item.skill === 'string' &&
          typeof item.period === 'string' &&
          typeof item.value === 'number' &&
          Number.isFinite(item.value),
      )
      .map((item) => ({
        skillName: item.skill,
        period: item.period,
        value: item.value,
        unit: item.unit ?? 'вакансий',
        region: item.region ?? null,
        source: 'Внешний источник рыночных данных',
        confidence:
          item.confidence === 'HIGH' || item.confidence === 'MEDIUM' || item.confidence === 'LOW'
            ? item.confidence
            : 'MEDIUM',
        isMock: false,
      }))
  }
}
