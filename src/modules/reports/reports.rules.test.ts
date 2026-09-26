import { describe, expect, it } from 'vitest'
import {
  CATALOG_REPORT_HEADERS,
  TZ_REPORT_HEADERS,
  readReportXlsxRows,
  reportCsv,
  reportJsonBody,
  reportXlsx,
  type ReportPayload,
} from './reports.rules'

/**
 * Заголовки колонок — дословно из ТЗ (задание, п.7 и п.8) — и три формата
 * (csv, xlsx, json), которые их отдают одинаково (решение 145, п.10).
 */
describe('заголовки колонок — дословно и по порядку из ТЗ', () => {
  it('отчёт «по ТЗ» (п.7)', () => {
    expect([...TZ_REPORT_HEADERS]).toEqual([
      'Наименование вуза',
      'ИТ-направление',
      'ИТ-продукт',
      'Статус работы с вузом',
      'Ответственный',
    ])
  })

  it('«Каталог по ТЗ» (п.8)', () => {
    expect([...CATALOG_REPORT_HEADERS]).toEqual([
      'Название вуза',
      'Вендор',
      'ПО',
      'Номер договора',
      'Подписание лицензии',
      'Срок действия лицензии (год)',
      'Статус по передаче',
      'ФИО менеджера',
      'Ответственные от вуза',
      'Комментарий',
    ])
  })
})

const payload: ReportPayload = {
  columns: TZ_REPORT_HEADERS,
  rows: [
    ['СПбГУТ', 'Программная инженерия', 'Конвейер сборки', 'В работе', 'Савельева Ольга Дмитриевна'],
    ['МТУСИ; "особый" вуз', 'Облако', null, 'Черновик', 'Кириллов Пётр Андреевич'],
  ],
}

describe('csv', () => {
  it('первая строка — заголовки, разделитель «;», BOM для Excel', () => {
    const csv = reportCsv(payload)
    expect(csv.startsWith('﻿')).toBe(true)
    const [header] = csv.replace('﻿', '').split('\r\n')
    expect(header).toBe(
      'Наименование вуза;ИТ-направление;ИТ-продукт;Статус работы с вузом;Ответственный',
    )
  })

  it('значение с разделителем и кавычками — в кавычках, кавычка удвоена', () => {
    const csv = reportCsv(payload)
    expect(csv).toContain('"МТУСИ; ""особый"" вуз"')
  })

  it('значение с разделителем без кавычек берётся в кавычки целиком', () => {
    const csv = reportCsv(payload)
    expect(csv).toContain('"МТУСИ; ')
  })

  it('пустая ячейка (null) — пустая строка, а не «null»', () => {
    const csv = reportCsv(payload)
    expect(csv).not.toContain('null')
  })
})

describe('xlsx — своим писателем, круговой тест своим читателем', () => {
  it('заголовки и строки читаются назад ровно тем же текстом', () => {
    const buffer = reportXlsx(payload, new Date('2026-09-26T00:00:00.000Z'))
    const rows = readReportXlsxRows(buffer)

    expect(rows[0]).toEqual([...TZ_REPORT_HEADERS])
    expect(rows[1]).toEqual(payload.rows[0])
    // Пустая ячейка (null) при записи пропускается — при чтении назад пустая строка.
    expect(rows[2]).toEqual(['МТУСИ; "особый" вуз', 'Облако', '', 'Черновик', 'Кириллов Пётр Андреевич'])
  })

  it('файл действительно открывается писателем xlsx (не бросает)', () => {
    expect(() => readReportXlsxRows(reportXlsx(payload))).not.toThrow()
  })
})

describe('json — схема generatedAt/filters/columns/rows (ТЗ, требования к решению п.4)', () => {
  it('несёт ровно эти четыре поля с переданными данными', () => {
    const now = new Date('2026-09-26T12:00:00.000Z')
    const body = reportJsonBody(payload, { format: 'json' }, now)

    expect(Object.keys(body).sort()).toEqual(['columns', 'filters', 'generatedAt', 'rows'])
    expect(body.generatedAt).toBe(now.toISOString())
    expect(body.filters).toEqual({ format: 'json' })
    expect(body.columns).toEqual(TZ_REPORT_HEADERS)
    expect(body.rows).toEqual(payload.rows)
  })
})
