import { describe, expect, it } from 'vitest'
import {
  reportCellText,
  reportFileHref,
  reportGeneratedLine,
  reportPrintTitle,
  reportRowsSummary,
} from './report-table'

describe('reportFileHref', () => {
  it('собирает ссылку на файл отчёта с выбранным форматом', () => {
    expect(reportFileHref('/api/reports/tz', 'csv')).toBe('/api/reports/tz?format=csv')
    expect(reportFileHref('/api/reports/catalog', 'xlsx')).toBe('/api/reports/catalog?format=xlsx')
    expect(reportFileHref('/api/reports/tz', 'json')).toBe('/api/reports/tz?format=json')
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
