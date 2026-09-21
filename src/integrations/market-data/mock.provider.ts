import type {
  MarketDataProvider,
  MarketDataProviderInfo,
  MarketDemandRecord,
} from './provider'

/**
 * Демонстрационный набор. Подготовлен вручную, автоматический сбор не реализован —
 * это прямо указано в ограничениях прототипа.
 */
const DEMO_DEMAND: ReadonlyArray<{ skillName: string; value: number }> = [
  { skillName: 'SQL', value: 9600 },
  { skillName: 'Python', value: 9400 },
  { skillName: 'Kubernetes', value: 7900 },
  { skillName: 'JavaScript', value: 7800 },
  { skillName: 'PostgreSQL', value: 7400 },
  { skillName: 'Docker', value: 6400 },
  { skillName: 'Java', value: 6000 },
  { skillName: 'Аналитика данных', value: 5600 },
  { skillName: 'Linux', value: 5400 },
  { skillName: 'Информационная безопасность', value: 5300 },
  { skillName: 'Облачные платформы', value: 4400 },
  { skillName: 'Машинное обучение', value: 4200 },
  { skillName: 'CI/CD', value: 4100 },
  { skillName: 'Тестирование ПО', value: 3500 },
  { skillName: 'Микросервисы', value: 3400 },
  { skillName: 'Сетевые технологии', value: 2700 },
  { skillName: 'Управление проектами', value: 2500 },
  { skillName: 'Бизнес-анализ', value: 2200 },
]

export const DEFAULT_MOCK_PERIOD = '2026-Q1'

export class MockMarketDataProvider implements MarketDataProvider {
  info(): MarketDataProviderInfo {
    return {
      kind: 'mock',
      name: 'Демонстрационный набор вакансий',
      ready: true,
      reason: null,
      isMock: true,
    }
  }

  async fetchDemand(period = DEFAULT_MOCK_PERIOD): Promise<MarketDemandRecord[]> {
    return DEMO_DEMAND.map((item) => ({
      skillName: item.skillName,
      period,
      value: item.value,
      unit: 'вакансий',
      region: 'Россия',
      source: 'Демонстрационный набор вакансий',
      confidence: 'LOW' as const,
      isMock: true,
    }))
  }
}
