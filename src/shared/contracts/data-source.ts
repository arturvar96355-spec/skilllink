import type { ConfidenceLevel, DataSourceType } from './enums'

export interface DataSourceDto {
  id: string
  name: string
  type: DataSourceType
  url: string | null
  collectionDate: string | null
  reliability: ConfidenceLevel
  description: string | null
  isMock: boolean
  /** Сколько показателей рынка пришло из этого источника. */
  demandRecords: number
  updatedAt: string
}

export interface IntegrationStatusDto {
  key: string
  name: string
  enabled: boolean
  /** Настроены ли адрес, путь или токен. */
  configured: boolean
  /** Чего не хватает или почему выключено. */
  reason: string | null
  isMock: boolean
}

/**
 * Состояние ИИ-помощника (решение 90) — строка во вкладке «Интеграции».
 *
 * Только то, что задано настройкой: провайдер, модель, хватает ли ключа и каталога.
 * Ни ключей, ни их фрагментов, ни идентификатора каталога здесь нет — в `reason`
 * только имена недостающих переменных окружения.
 */
export interface AiAssistStatusDto {
  /** `AI_ASSIST_PROVIDER`: `off` — выключен, ответы пишет шаблон. */
  provider: 'off' | 'yandexgpt' | 'gigachat'
  /** YandexGPT, GigaChat или «ИИ-помощник выключен». */
  name: string
  /** Ключ (и у YandexGPT — каталог) заданы. Связь с моделью не проверяется. */
  ready: boolean
  /** Модель из настройки; у выключенного — null. */
  model: string | null
  /** Чего не хватает или почему выключен. */
  reason: string | null
}

export interface IntegrationsStatusDto {
  marketDataProvider: string
  integrations: IntegrationStatusDto[]
  /** ИИ-помощник (с 25.09.2026). */
  aiAssist: AiAssistStatusDto
  checkedAt: string
}

export interface MarketDataSyncResultDto {
  provider: string
  period: string | null
  /** Сколько показателей создано и обновлено. */
  imported: number
  updated: number
  /** Навыки из источника, которых нет в справочнике: они пропущены, а не выдуманы. */
  unknownSkills: string[]
  isMock: boolean
  syncedAt: string
}
