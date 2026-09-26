import { describe, expect, it } from 'vitest'
import { filenameFromDisposition } from './api'

/** Имя скачанного файла — то, что покажет сообщение «Файл … скачан». */
describe('filenameFromDisposition', () => {
  it('обычное имя в кавычках — как отдаёт /api/export', () => {
    expect(filenameFromDisposition('attachment; filename="cooperations-2026-09-26.csv"', 'x.csv')).toBe(
      'cooperations-2026-09-26.csv',
    )
  })

  it('русское имя в filename* берётся раньше запасного ASCII-имени', () => {
    const header = `attachment; filename="report.xlsx"; filename*=UTF-8''${encodeURIComponent('Отчёт по ТЗ.xlsx')}`
    expect(filenameFromDisposition(header, 'x.xlsx')).toBe('Отчёт по ТЗ.xlsx')
  })

  it('без заголовка или с кривой кодировкой — запасное имя, а не пустота', () => {
    expect(filenameFromDisposition(null, 'report.csv')).toBe('report.csv')
    expect(filenameFromDisposition("attachment; filename*=UTF-8''%E0%A4%A", 'report.csv')).toBe('report.csv')
  })
})
