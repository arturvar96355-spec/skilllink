import { describe, expect, it } from 'vitest'
import { funnelQuerySchema } from './stage-analytics.schema'

/**
 * Параметры воронки этапов (решение 120, исправление 187): `from`/`to` без
 * времени должны разворачиваться в московские сутки — той же функцией
 * `dateBoundarySchema`, что и в `reports.schema.ts`. До исправления даты
 * проходили как есть и потом сравнивались как UTC-моменты: связка, начатая
 * поздно вечером по Москве в последний день периода или рано утром по
 * Москве в первый, могла выпасть из выборки.
 */
describe('funnelQuerySchema: границы периода по московским суткам', () => {
  it('дата без времени (ГГГГ-ММ-ДД) разворачивается в начало/конец московских суток UTC', () => {
    const result = funnelQuerySchema.parse({ from: '2026-01-01', to: '2026-01-01' })
    // Москва UTC+3: начало суток 1 января по Москве — 31 декабря 21:00 UTC.
    expect(result.from).toBe('2025-12-31T21:00:00.000Z')
    expect(result.to).toBe('2026-01-01T20:59:59.999Z')
  })

  it('полный ISO 8601 с временем проходит как есть', () => {
    const result = funnelQuerySchema.parse({ from: '2026-01-01T00:00:00.000Z' })
    expect(result.from).toBe('2026-01-01T00:00:00.000Z')
  })

  it('без параметров периода — оба поля не заданы', () => {
    const result = funnelQuerySchema.parse({})
    expect(result.from).toBeUndefined()
    expect(result.to).toBeUndefined()
  })

  it('некорректная дата отклоняется', () => {
    expect(() => funnelQuerySchema.parse({ from: '2026-13-40' })).toThrow()
  })
})
