import { describe, expect, it } from 'vitest'
import {
  EMPTY_REPORT_FILTERS,
  hasReportFilters,
  reportCellText,
  reportFileHref,
  reportFiltersLine,
  reportGeneratedLine,
  reportPreviewPath,
  reportPrintTitle,
  reportRowsSummary,
  type ReportFilterValues,
} from './report-table'

describe('reportFileHref', () => {
  it('без фильтров — только формат', () => {
    expect(reportFileHref('/api/reports/tz', 'csv', EMPTY_REPORT_FILTERS)).toBe('/api/reports/tz?format=csv')
    expect(reportFileHref('/api/reports/catalog', 'xlsx', EMPTY_REPORT_FILTERS)).toBe(
      '/api/reports/catalog?format=xlsx',
    )
    expect(reportFileHref('/api/reports/tz', 'json', EMPTY_REPORT_FILTERS)).toBe('/api/reports/tz?format=json')
  })

  it('с фильтрами — они уходят параметрами запроса вместе с форматом', () => {
    const filters: ReportFilterValues = {
      ...EMPTY_REPORT_FILTERS,
      dateFrom: '2026-01-01',
      dateTo: '2026-06-30',
      status: 'ACTIVE',
    }
    const href = reportFileHref('/api/reports/tz', 'xlsx', filters)
    expect(href).toContain('format=xlsx')
    expect(href).toContain('dateFrom=2026-01-01')
    expect(href).toContain('dateTo=2026-06-30')
    expect(href).toContain('status=ACTIVE')
  })
})

describe('reportPreviewPath', () => {
  it('всегда просит json — вне зависимости от того, что скачивают кнопки', () => {
    expect(reportPreviewPath('/api/reports/tz', EMPTY_REPORT_FILTERS)).toBe('/api/reports/tz?format=json')
    expect(reportPreviewPath('/api/reports/tz', { ...EMPTY_REPORT_FILTERS, universityId: 'u1' })).toBe(
      '/api/reports/tz?universityId=u1&format=json',
    )
  })
})

describe('hasReportFilters', () => {
  it('без фильтров — false', () => {
    expect(hasReportFilters(EMPTY_REPORT_FILTERS)).toBe(false)
  })

  it('хоть один фильтр задан — true', () => {
    expect(hasReportFilters({ ...EMPTY_REPORT_FILTERS, status: 'ACTIVE' })).toBe(true)
  })
})

describe('reportFiltersLine', () => {
  it('без фильтров — null', () => {
    expect(reportFiltersLine(EMPTY_REPORT_FILTERS, {})).toBeNull()
  })

  it('период, вуз по имени, статус по подписи', () => {
    const line = reportFiltersLine(
      { ...EMPTY_REPORT_FILTERS, dateFrom: '2026-01-01', dateTo: '2026-06-30', universityId: 'u1', status: 'ACTIVE' },
      { universityName: 'СПбГУТ', statusLabel: 'В работе' },
    )
    expect(line).toBe('Фильтры: период 01.01.2026 — 30.06.2026 · вуз «СПбГУТ» · статус «В работе»')
  })

  it('имя ещё не загрузилось — многоточие вместо пустой строки', () => {
    const line = reportFiltersLine({ ...EMPTY_REPORT_FILTERS, universityId: 'u1' }, {})
    expect(line).toBe('Фильтры: вуз «…»')
  })
})

describe('reportCellText', () => {
  it('пустая ячейка — «Нет данных», а не пустое место', () => {
    expect(reportCellText(null)).toBe('Нет данных')
    expect(reportCellText('')).toBe('Нет данных')
    expect(reportCellText('   ')).toBe('Нет данных')
  })

  it('заполненная ячейка — строкой как есть, число — текстом', () => {
    expect(reportCellText('СПбГУТ')).toBe('СПбГУТ')
    expect(reportCellText(3)).toBe('3')
    expect(reportCellText(0)).toBe('0')
  })
})

describe('reportRowsSummary', () => {
  it('число строк — с правильным словом', () => {
    expect(reportRowsSummary(1)).toBe('1 строка')
    expect(reportRowsSummary(3)).toBe('3 строки')
    expect(reportRowsSummary(5)).toBe('5 строк')
    expect(reportRowsSummary(0)).toBe('0 строк')
  })
})

describe('reportGeneratedLine и reportPrintTitle', () => {
  it('строка формирования — дата и время по Москве', () => {
    expect(reportGeneratedLine('2026-09-26T11:05:00.000Z')).toContain('(МСК)')
  })

  it('заголовок печати — имя файла PDF: дата по Москве, без двоеточий', () => {
    // 22:30 UTC 24.09 — в Москве уже 25.09.
    const title = reportPrintTitle('Отчёт по ТЗ', '2026-09-24T22:30:00.000Z')
    expect(title).toBe('Отчёт по ТЗ SkillLink 25.09.2026')
    expect(title).not.toContain(':')
  })
})
