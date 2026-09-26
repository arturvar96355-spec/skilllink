import { describe, expect, it } from 'vitest'
import {
  CATALOG_REPORT_HEADERS,
  TZ_REPORT_HEADERS,
  readReportXlsxRows,
  reportCsv,
  reportFileNameSuffix,
  reportFiltersSummary,
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

describe('фильтры отчётов в файле (решение 172)', () => {
  it('без фильтров — csv/xlsx выглядят так же, как раньше', () => {
    expect(reportCsv(payload)).toBe(reportCsv(payload, null))
    expect(readReportXlsxRows(reportXlsx(payload))).toEqual(readReportXlsxRows(reportXlsx(payload, undefined, null)))
  })

  it('со строкой-заголовком — csv несёт её первой строкой перед колонками', () => {
    const csv = reportCsv(payload, 'Фильтры: период 01.01.2026 — 30.06.2026 · статус «В работе»')
    const lines = csv.replace('﻿', '').split('\r\n')
    expect(lines[0]).toBe('Фильтры: период 01.01.2026 — 30.06.2026 · статус «В работе»')
    expect(lines[1]).toBe('Наименование вуза;ИТ-направление;ИТ-продукт;Статус работы с вузом;Ответственный')
  })

  it('со строкой-заголовком — xlsx несёт её первой строкой, колонки — второй', () => {
    const rows = readReportXlsxRows(reportXlsx(payload, new Date('2026-09-26T00:00:00.000Z'), 'Фильтры: статус «В работе»'))
    expect(rows[0]).toEqual(['Фильтры: статус «В работе»'])
    expect(rows[1]).toEqual([...TZ_REPORT_HEADERS])
    expect(rows[2]).toEqual(payload.rows[0])
  })

  it('reportFiltersSummary: без фильтров — null', () => {
    expect(reportFiltersSummary({}, {})).toBeNull()
  })

  it('reportFiltersSummary: период, вуз (без резолвнутого имени — id), статус', () => {
    const summary = reportFiltersSummary(
      {
        dateFrom: '2026-01-01T00:00:00.000+03:00',
        dateTo: '2026-06-30T23:59:59.999+03:00',
        universityId: 'u1',
        status: 'ACTIVE',
      },
      {},
    )
    expect(summary).toBe('Фильтры: период 01.01.2026 — 30.06.2026 · вуз «u1» · статус «В работе»')
  })

  it('reportFiltersSummary: имя вуза берётся из резолвнутых labels, когда есть', () => {
    const summary = reportFiltersSummary({ universityId: 'u1' }, { universityName: 'СПбГУТ' })
    expect(summary).toBe('Фильтры: вуз «СПбГУТ»')
  })

  it('reportFileNameSuffix: без фильтров — пустая строка', () => {
    expect(reportFileNameSuffix({})).toBe('')
  })

  it('reportFileNameSuffix: период и статус — читаемый хвост имени файла', () => {
    expect(
      reportFileNameSuffix({
        dateFrom: '2026-01-01T00:00:00.000+03:00',
        dateTo: '2026-06-30T23:59:59.999+03:00',
        status: 'ACTIVE',
      }),
    ).toBe('_from-2026-01-01_to-2026-06-30_status-active')
  })

  it('reportFileNameSuffix: вуз/программа/продукт/ответственный не попадают в имя файла', () => {
    expect(reportFileNameSuffix({ universityId: 'u1', programId: 'p1', productId: 'pr1', responsibleId: 'r1' })).toBe(
      '',
    )
  })
})
