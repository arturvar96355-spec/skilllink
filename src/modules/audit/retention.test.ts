import { describe, expect, it } from 'vitest'
import { RETENTION } from '@/shared/config/retention.config'
import {
  hasClientAddress,
  planRetention,
  retentionCutoffs,
  stripClientAddress,
  type RetentionRow,
} from './retention.rules'

const NOW = new Date('2026-09-25T12:00:00.000Z')
const POLICY = { auditLogDays: 365, clientAddressDays: 90 }
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000)

describe('сроки хранения по умолчанию', () => {
  it('журнал — год, адрес клиента — 90 дней', () => {
    expect(RETENTION.auditLogDays).toBe(365)
    expect(RETENTION.clientAddressDays).toBe(90)
  })
})

describe('границы по сроку', () => {
  it('считаются от текущего момента', () => {
    const cutoffs = retentionCutoffs(NOW, POLICY)
    expect(cutoffs.deleteBefore.toISOString()).toBe('2025-09-25T12:00:00.000Z')
    expect(cutoffs.stripAddressBefore.toISOString()).toBe('2026-06-27T12:00:00.000Z')
  })

  it('ноль, отрицательный и дробный срок — ошибка, а не «удалить всё»', () => {
    expect(() => retentionCutoffs(NOW, { ...POLICY, auditLogDays: 0 })).toThrow()
    expect(() => retentionCutoffs(NOW, { ...POLICY, auditLogDays: -1 })).toThrow()
    expect(() => retentionCutoffs(NOW, { ...POLICY, clientAddressDays: 1.5 })).toThrow()
    expect(() => retentionCutoffs(NOW, { ...POLICY, clientAddressDays: Number.NaN })).toThrow()
  })
})

describe('адрес клиента в записи', () => {
  it('находится в записях входа и выгрузки', () => {
    expect(hasClientAddress({ address: '203.0.113.7' })).toBe(true)
    expect(hasClientAddress({ address: 'unknown', knownAccount: false })).toBe(true)
  })

  it('нет адреса — нечего стирать', () => {
    expect(hasClientAddress(null)).toBe(false)
    expect(hasClientAddress({ fields: ['name'] })).toBe(false)
    expect(hasClientAddress(['address'])).toBe(false)
    expect(hasClientAddress('address')).toBe(false)
  })

  it('уже стёртый адрес повторно не стирается', () => {
    expect(hasClientAddress({ address: null })).toBe(false)
  })

  it('стирается только адрес, остальное остаётся', () => {
    expect(stripClientAddress({ address: '203.0.113.7', rows: 12, dataset: 'universities' })).toEqual({
      address: null,
      rows: 12,
      dataset: 'universities',
    })
  })
})

describe('отбор записей', () => {
  const cutoffs = retentionCutoffs(NOW, POLICY)
  const rows: RetentionRow[] = [
    { id: 'fresh-with-ip', createdAt: daysAgo(10), payload: { address: '203.0.113.7' } },
    { id: 'old-with-ip', createdAt: daysAgo(120), payload: { address: '203.0.113.7' } },
    { id: 'old-no-ip', createdAt: daysAgo(120), payload: { fields: ['name'] } },
    { id: 'old-stripped', createdAt: daysAgo(200), payload: { address: null } },
    { id: 'expired-with-ip', createdAt: daysAgo(400), payload: { address: '203.0.113.7' } },
    { id: 'expired-no-payload', createdAt: daysAgo(366), payload: null },
  ]

  it('старше года — удаляются целиком, с адресом и без', () => {
    expect(planRetention(rows, cutoffs).deleteIds).toEqual(['expired-with-ip', 'expired-no-payload'])
  })

  it('старше 90 дней с адресом — адрес стирается; без адреса и свежие — не трогаются', () => {
    expect(planRetention(rows, cutoffs).stripIds).toEqual(['old-with-ip'])
  })

  it('ровно на границе запись ещё хранится', () => {
    const edge: RetentionRow[] = [
      { id: 'edge-delete', createdAt: cutoffs.deleteBefore, payload: null },
      { id: 'edge-strip', createdAt: cutoffs.stripAddressBefore, payload: { address: '203.0.113.7' } },
    ]
    expect(planRetention(edge, cutoffs)).toEqual({ deleteIds: [], stripIds: [] })
  })
})
