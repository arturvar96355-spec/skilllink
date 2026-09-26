import { describe, expect, it } from 'vitest'
import { buildReportWhere } from './reports.repo'

/**
 * Фильтры отчётов (решение 172) — условие выборки строится один раз и одинаково
 * для отчёта «по ТЗ» и «Каталога по ТЗ» (`findTzRows`/`findCatalogRows` из
 * `buildReportWhere`), поэтому проверяется само условие, без похода в базу.
 */
describe('buildReportWhere — условие фильтров отчётов', () => {
  it('без фильтров и без области видимости — пустое условие', () => {
    expect(buildReportWhere({}, {})).toEqual({})
  })

  it('вуз, программа, продукт, ответственный и статус — каждый своим полем', () => {
    const where = buildReportWhere(
      {
        universityId: 'u1',
        programId: 'p1',
        productId: 'pr1',
        responsibleId: 'r1',
        status: 'ACTIVE',
      },
      {},
    )
    expect(where).toEqual({
      universityId: 'u1',
      programId: 'p1',
      productId: 'pr1',
      responsibleId: 'r1',
      status: 'ACTIVE',
    })
  })

  describe('область видимости представителя вуза', () => {
    it('без запрошенного вуза — сужает условие до своего', () => {
      expect(buildReportWhere({}, { universityId: 'own' })).toEqual({ universityId: 'own' })
    })

    it('запрошен свой же вуз — условие то же самое', () => {
      expect(buildReportWhere({ universityId: 'own' }, { universityId: 'own' })).toEqual({
        universityId: 'own',
      })
    })

    it('запрошен чужой вуз — `null`, выборка заведомо пуста', () => {
      expect(buildReportWhere({ universityId: 'other' }, { universityId: 'own' })).toBeNull()
    })
  })

  describe('период — связки, действующие в периоде', () => {
    it('только конец периода — созданные не позже него', () => {
      const where = buildReportWhere({ dateTo: '2026-06-30T23:59:59.999Z' }, {})
      expect(where).toEqual({
        AND: [{ createdAt: { lte: new Date('2026-06-30T23:59:59.999Z') } }],
      })
    })

    it('только начало периода — не закрытые до него (или ещё не закрыты)', () => {
      const where = buildReportWhere({ dateFrom: '2026-01-01T00:00:00.000Z' }, {})
      expect(where).toEqual({
        AND: [{ OR: [{ closedAt: null }, { closedAt: { gte: new Date('2026-01-01T00:00:00.000Z') } }] }],
      })
    })

    it('обе границы — оба условия одновременно (пересечение, а не замена)', () => {
      const where = buildReportWhere(
        { dateFrom: '2026-01-01T00:00:00.000Z', dateTo: '2026-06-30T23:59:59.999Z' },
        {},
      )
      expect(where).toEqual({
        AND: [
          { createdAt: { lte: new Date('2026-06-30T23:59:59.999Z') } },
          { OR: [{ closedAt: null }, { closedAt: { gte: new Date('2026-01-01T00:00:00.000Z') } }] },
        ],
      })
    })
  })

  it('фильтры и область видимости складываются, а не заменяют друг друга', () => {
    const where = buildReportWhere({ programId: 'p1', status: 'PAUSED' }, { universityId: 'own' })
    expect(where).toEqual({ universityId: 'own', programId: 'p1', status: 'PAUSED' })
  })
})
