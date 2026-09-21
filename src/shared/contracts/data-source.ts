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

export interface IntegrationsStatusDto {
  marketDataProvider: string
  integrations: IntegrationStatusDto[]
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
