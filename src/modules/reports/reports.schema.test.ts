import { describe, expect, it } from 'vitest'
import { reportQuerySchema } from './reports.schema'

/**
 * Схема параметров отчётов (решение 172): фильтры по периоду, вузу,
 * ИТ-направлению, ИТ-продукту, ответственному и статусу — все необязательны,
 * работают вместе с `format`.
 */
describe('reportQuerySchema', () => {
  it('без параметров — только формат по умолчанию (csv)', () => {
    const result = reportQuerySchema.parse({})
    expect(result).toEqual({ format: 'csv' })
  })

  it('принимает все фильтры сразу вместе с форматом', () => {
    const result = reportQuerySchema.parse({
      format: 'xlsx',
      dateFrom: '2026-01-01',
      dateTo: '2026-06-30',
      universityId: 'u1',
      programId: 'p1',
      productId: 'pr1',
      responsibleId: 'r1',
      status: 'ACTIVE',
    })
    expect(result.format).toBe('xlsx')
    expect(result.universityId).toBe('u1')
    expect(result.programId).toBe('p1')
    expect(result.productId).toBe('pr1')
    expect(result.responsibleId).toBe('r1')
    expect(result.status).toBe('ACTIVE')
  })

  it('дата без времени (ГГГГ-ММ-ДД) разворачивается в начало/конец московских суток UTC', () => {
    const result = reportQuerySchema.parse({ dateFrom: '2026-01-01', dateTo: '2026-01-01' })
    // Москва UTC+3: начало суток 1 января по Москве — 31 декабря 21:00 UTC.
    expect(result.dateFrom).toBe('2025-12-31T21:00:00.000Z')
    expect(result.dateTo).toBe('2026-01-01T20:59:59.999Z')
  })

  it('полный ISO 8601 с временем проходит как есть', () => {
    const result = reportQuerySchema.parse({ dateFrom: '2026-01-01T00:00:00.000Z' })
    expect(result.dateFrom).toBe('2026-01-01T00:00:00.000Z')
  })

  it('неизвестный статус — ошибка валидации', () => {
    expect(() => reportQuerySchema.parse({ status: 'NOT_A_STATUS' })).toThrow()
  })

  it('неизвестный формат — ошибка валидации', () => {
    expect(() => reportQuerySchema.parse({ format: 'pdf' })).toThrow()
  })

  it('некорректная дата — ошибка валидации', () => {
    expect(() => reportQuerySchema.parse({ dateFrom: '2026-13-40' })).toThrow()
  })

  it('начало периода позже конца — ошибка валидации', () => {
    expect(() => reportQuerySchema.parse({ dateFrom: '2026-06-30', dateTo: '2026-01-01' })).toThrow()
  })

  it('начало периода раньше конца — проходит', () => {
    expect(() => reportQuerySchema.parse({ dateFrom: '2026-01-01', dateTo: '2026-06-30' })).not.toThrow()
  })

  it('пустая строка идентификатора — ошибка валидации (min(1))', () => {
    expect(() => reportQuerySchema.parse({ universityId: '' })).toThrow()
  })
})
