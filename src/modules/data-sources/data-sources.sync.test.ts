import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CurrentUser } from '@/shared/auth/current-user'
import type { MarketDemandRecord } from '@/integrations/market-data/provider'

/**
 * Загрузка рыночных данных сопоставляет навык тем же ключом, что держит уникальность
 * справочника (`skillNameKey`, решение 110): «ML Ops» из источника — это «MLOps»
 * из справочника, а не неизвестный навык. База и источник подменены.
 */
const mocks = vi.hoisted(() => ({
  prisma: {
    skill: { findMany: vi.fn() },
    dataSource: { upsert: vi.fn() },
    marketDemand: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  },
  records: [] as MarketDemandRecord[],
  writeAudit: vi.fn(),
}))

vi.mock('@/shared/db/prisma', () => ({ prisma: mocks.prisma }))
vi.mock('@/shared/audit/audit', () => ({ writeAudit: mocks.writeAudit }))
vi.mock('@/integrations/market-data', () => ({
  getMarketDataProvider: () => ({
    info: () => ({ kind: 'mock', name: 'Проверочный источник', ready: true, reason: null, isMock: true }),
    fetchDemand: async () => mocks.records,
  }),
}))

const { syncMarketData } = await import('./data-sources.service')

const analyst: CurrentUser = {
  id: 'me',
  email: 'analyst@skilllink.demo',
  fullName: 'Аналитик',
  role: 'ANALYST',
  universityId: null,
}

const record = (skillName: string, value = 100): MarketDemandRecord => ({
  skillName,
  period: '2026-Q1',
  value,
  unit: 'вакансий',
  region: null,
  source: 'Проверочный источник',
  confidence: 'LOW',
  isMock: true,
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.prisma.skill.findMany.mockResolvedValue([
    { id: 'mlops', name: 'MLOps' },
    { id: 'ml', name: 'Machine Learning' },
    { id: 'is', name: 'Информационная безопасность' },
  ])
  mocks.prisma.dataSource.upsert.mockResolvedValue({ id: 'ds' })
  mocks.prisma.marketDemand.findUnique.mockResolvedValue(null)
})

describe('загрузка рыночных данных: навык по ключу названия', () => {
  it('регистр и пробелы из источника не делают навык неизвестным', async () => {
    mocks.records = [
      record('ML Ops'),
      record('machine   LEARNING'),
      record('Machine\u00a0Learning'),
      record('ИНФОРМАЦИОННАЯБЕЗОПАСНОСТЬ'),
    ]
    const result = await syncMarketData(analyst, {})

    expect(result.unknownSkills).toEqual([])
    const skillIds = mocks.prisma.marketDemand.create.mock.calls.map(([arg]) => arg.data.skillId)
    expect(skillIds).toEqual(['mlops', 'ml', 'ml', 'is'])
  })

  it('неизвестный навык пропускается и назван один раз, как бы его ни писали', async () => {
    mocks.records = [record('Rust'), record('RUST'), record('R ust'), record('Kotlin')]
    const result = await syncMarketData(analyst, {})

    expect(result.unknownSkills).toEqual(['Rust', 'Kotlin'])
    expect(result.imported).toBe(0)
    expect(mocks.prisma.marketDemand.create).not.toHaveBeenCalled()
    expect(mocks.writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'datasource.sync', payload: expect.objectContaining({ unknown: 2 }) }),
    )
  })
})
