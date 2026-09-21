import { readFile } from 'node:fs/promises'
import { integrationError } from '@/shared/http/errors'
import type {
  MarketDataProvider,
  MarketDataProviderInfo,
  MarketDemandRecord,
} from './provider'

/**
 * Рыночные данные из CSV-файла: подготовленная выгрузка вместо живого API.
 * Ожидаемые колонки: skill,period,value,unit,region,source,confidence
 */
export class CsvMarketDataProvider implements MarketDataProvider {
  constructor(private readonly path: string | null) {}

  info(): MarketDataProviderInfo {
    return {
      kind: 'csv',
      name: 'Выгрузка рыночных данных из CSV',
      ready: this.path !== null,
      reason: this.path === null ? 'Не задан MARKET_DATA_CSV_PATH' : null,
      // Файл готовит человек: это подтверждённые данные, а не демонстрационные.
      isMock: false,
    }
  }

  async fetchDemand(period?: string): Promise<MarketDemandRecord[]> {
    if (!this.path) {
      throw integrationError('Источник CSV не настроен: не задан MARKET_DATA_CSV_PATH')
    }

    let raw: string
    try {
      raw = await readFile(this.path, 'utf8')
    } catch (error) {
      throw integrationError(
        `Не удалось прочитать файл рыночных данных: ${
          error instanceof Error ? error.message : 'неизвестная ошибка'
        }`,
      )
    }

    const lines = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)

    if (lines.length <= 1) return []

    const records: MarketDemandRecord[] = []
    // Первая строка — заголовок.
    for (const line of lines.slice(1)) {
      const parts = line.split(',').map((part) => part.trim())
      const [skillName, rowPeriod, value, unit, region, source, confidence] = parts

      if (!skillName || !rowPeriod || value === undefined) continue
      if (period && rowPeriod !== period) continue

      const numeric = Number(value)
      if (!Number.isFinite(numeric)) continue

      records.push({
        skillName,
        period: rowPeriod,
        value: numeric,
        unit: unit && unit.length > 0 ? unit : 'вакансий',
        region: region && region.length > 0 ? region : null,
        source: source && source.length > 0 ? source : 'CSV-выгрузка',
        confidence:
          confidence === 'HIGH' || confidence === 'MEDIUM' || confidence === 'LOW'
            ? confidence
            : 'MEDIUM',
        isMock: false,
      })
    }

    return records
  }
}
