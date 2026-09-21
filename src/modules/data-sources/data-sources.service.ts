import { pageMeta } from '@/shared/http/pagination'
import { assertCan } from '@/shared/auth/permissions'
import { writeAudit } from '@/shared/audit/audit'
import type { CurrentUser } from '@/shared/auth/current-user'
import type { PageMeta } from '@/shared/contracts/common'
import type {
  DataSourceDto,
  IntegrationsStatusDto,
  MarketDataSyncResultDto,
} from '@/shared/contracts/data-source'
import { toIso, toIsoRequired } from '@/shared/utils/date'
import { getIntegrationsConfig } from '@/integrations/config'
import { getMarketDataProvider } from '@/integrations/market-data'
import { getLmsClient } from '@/integrations/lms/lms.client'
import { getSiteClient } from '@/integrations/site/site.client'
import * as repo from './data-sources.repo'
import type { DataSourceListQuery, SyncMarketDataInput } from './data-sources.schema'

export async function list(
  user: CurrentUser,
  query: DataSourceListQuery,
): Promise<{ data: DataSourceDto[]; meta: PageMeta }> {
  assertCan(user, 'ANALYTICS')
  const { rows, total } = await repo.findMany(query)

  return {
    data: rows.map((row) => ({
      id: row.id,
      name: row.name,
      type: row.type,
      url: row.url,
      collectionDate: toIso(row.collectionDate),
      reliability: row.reliability,
      description: row.description,
      isMock: row.isMock,
      demandRecords: row._count.demand,
      updatedAt: toIsoRequired(row.updatedAt),
    })),
    meta: pageMeta({ page: query.page, pageSize: query.pageSize }, total),
  }
}

/**
 * Состояние интеграций. Показывает, что реально настроено, а что выключено.
 * Наличие конкретных внутренних API заказчика не утверждается (решение 13).
 */
export function status(user: CurrentUser): IntegrationsStatusDto {
  assertCan(user, 'ANALYTICS')

  const config = getIntegrationsConfig()
  const marketData = getMarketDataProvider().info()
  const lms = getLmsClient().status()
  const site = getSiteClient().status()

  return {
    marketDataProvider: config.marketData.kind,
    integrations: [
      {
        key: 'market-data',
        name: marketData.name,
        enabled: true,
        configured: marketData.ready,
        reason: marketData.reason,
        isMock: marketData.isMock,
      },
      {
        key: 'lms',
        name: lms.name,
        enabled: lms.enabled,
        configured: lms.configured,
        reason: lms.reason,
        isMock: !lms.enabled,
      },
      {
        key: 'site',
        name: site.name,
        enabled: site.enabled,
        configured: site.configured,
        reason: site.reason,
        isMock: !site.enabled,
      },
    ],
    checkedAt: new Date().toISOString(),
  }
}

const SOURCE_TYPE_BY_KIND = {
  mock: 'MOCK',
  csv: 'CSV',
  'external-api': 'EXTERNAL_API',
  'future-rtk': 'EXTERNAL_API',
} as const

/**
 * Забирает рыночные данные у активного источника и складывает в таблицу market_demand.
 *
 * Навыки, которых нет в справочнике, пропускаются и возвращаются списком: придумывать
 * записи справочника по строке из внешнего источника нельзя — это тихо исказит аналитику.
 */
export async function syncMarketData(
  user: CurrentUser,
  input: SyncMarketDataInput,
): Promise<MarketDataSyncResultDto> {
  assertCan(user, 'WRITE')

  const config = getIntegrationsConfig()
  const provider = getMarketDataProvider()
  const info = provider.info()

  // Ошибка интеграции поднимется как INTEGRATION_ERROR (502) и не тронет остальную систему.
  const records = await provider.fetchDemand(input.period)

  const dataSource = await repo.upsertDataSource({
    name: info.name,
    type: SOURCE_TYPE_BY_KIND[config.marketData.kind],
    reliability: info.isMock ? 'LOW' : 'MEDIUM',
    isMock: info.isMock,
    description: info.isMock
      ? 'Подготовленный набор для демонстрации. Автоматический сбор не реализован.'
      : `Источник рыночных данных: ${config.marketData.kind}`,
  })

  const skillsByName = await repo.loadSkillsByName()
  const unknownSkills = new Set<string>()
  let imported = 0
  let updated = 0
  let period: string | null = null

  for (const record of records) {
    const skillId = skillsByName.get(record.skillName.toLowerCase())
    if (!skillId) {
      unknownSkills.add(record.skillName)
      continue
    }

    const result = await repo.upsertDemand({
      skillId,
      period: record.period,
      value: record.value,
      unit: record.unit,
      region: record.region,
      source: record.source,
      dataSourceId: dataSource.id,
      confidence: record.confidence,
      isMock: record.isMock,
    })

    if (result.created) imported += 1
    else updated += 1
    period = record.period
  }

  await writeAudit({
    userId: user.id,
    action: 'datasource.sync',
    objectType: 'DataSource',
    objectId: dataSource.id,
    payload: {
      provider: config.marketData.kind,
      imported,
      updated,
      unknown: unknownSkills.size,
    },
  })

  return {
    provider: config.marketData.kind,
    period: input.period ?? period,
    imported,
    updated,
    unknownSkills: [...unknownSkills],
    isMock: info.isMock,
    syncedAt: new Date().toISOString(),
  }
}
