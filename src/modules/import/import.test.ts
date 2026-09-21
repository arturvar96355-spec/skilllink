import { describe, expect, it } from 'vitest'
import { AppError } from '@/shared/http/errors'
import { toCsv } from '@/modules/export/export.rules'
import { cell, mapHeaders, numericCell, parseCsv } from './import.rules'
import { importQuerySchema } from './import.schema'

describe('разбор CSV', () => {
  it('читает простой файл', () => {
    expect(parseCsv('А;Б\r\n1;2\r\n')).toEqual([
      ['А', 'Б'],
      ['1', '2'],
    ])
  })

  it('пропускает BOM, который Excel ставит в начало', () => {
    expect(parseCsv('﻿Название;Город\r\nСПбГУТ;Санкт-Петербург\r\n')[0]).toEqual([
      'Название',
      'Город',
    ])
  })

  it('понимает и LF, и CRLF', () => {
    expect(parseCsv('А;Б\n1;2\n')).toEqual([
      ['А', 'Б'],
      ['1', '2'],
    ])
  })

  it('снимает кавычки и возвращает разделитель внутри значения', () => {
    expect(parseCsv('А;Б\r\n"Москва; Россия";2\r\n')[1]).toEqual(['Москва; Россия', '2'])
  })

  it('понимает удвоенные кавычки', () => {
    expect(parseCsv('А\r\n"Вуз ""Связь"""\r\n')[1]).toEqual(['Вуз "Связь"'])
  })

  it('держит перенос строки внутри кавычек', () => {
    const rows = parseCsv('А;Б\r\n"Первая\nвторая";2\r\n')
    expect(rows).toHaveLength(2)
    expect(rows[1]?.[0]).toBe('Первая\nвторая')
  })

  it('не создаёт пустую строку из завершающего перевода строки', () => {
    expect(parseCsv('А;Б\r\n1;2\r\n\r\n')).toHaveLength(2)
  })

  it('сохраняет пустые ячейки', () => {
    expect(parseCsv('А;Б;В\r\n1;;3\r\n')[1]).toEqual(['1', '', '3'])
  })

  it('читает обратно то, что написала выгрузка', () => {
    // Цикл «выгрузил → поправил → загрузил» обязан работать без потерь.
    const csv = toCsv(
      ['Название', 'Город', 'Примечание'],
      [['Вуз "Связь"', 'Москва; Россия', 'Первая\nвторая']],
    )
    const rows = parseCsv(csv)
    expect(rows[0]).toEqual(['Название', 'Город', 'Примечание'])
    expect(rows[1]).toEqual(['Вуз "Связь"', 'Москва; Россия', 'Первая\nвторая'])
  })

  it('обезвреженная выгрузкой формула читается с апострофом', () => {
    // Выгрузка добавляет апостроф перед «=», и при обратной загрузке это видно.
    const csv = toCsv(['Телефон'], [['+7 900 000-00-00']])
    expect(parseCsv(csv)[1]?.[0]).toBe("'+7 900 000-00-00")
  })
})

describe('сопоставление колонок', () => {
  const header = ['Город', 'Название', 'Регион', 'Сайт']

  it('находит колонки по названию, а не по порядку', () => {
    const index = mapHeaders(header, ['Название', 'Город', 'Регион'], ['Сайт'])
    expect(index.get('Название')).toBe(1)
    expect(index.get('Город')).toBe(0)
  })

  it('не различает регистр заголовков', () => {
    const index = mapHeaders(['НАЗВАНИЕ', 'город', 'Регион'], ['Название', 'Город', 'Регион'])
    expect(index.get('Название')).toBe(0)
  })

  it('сообщает, каких обязательных колонок не хватает', () => {
    try {
      mapHeaders(['Название'], ['Название', 'Город', 'Регион'])
      throw new Error('ожидалась ошибка')
    } catch (error) {
      expect(error).toBeInstanceOf(AppError)
      expect((error as AppError).code).toBe('VALIDATION_ERROR')
      expect(JSON.stringify((error as AppError).details)).toContain('Город')
    }
  })

  it('необязательная колонка может отсутствовать', () => {
    const index = mapHeaders(['Название'], ['Название'], ['Сайт'])
    expect(index.has('Сайт')).toBe(false)
  })
})

describe('чтение ячеек', () => {
  const index = mapHeaders(['Название', 'Студентов'], ['Название'], ['Студентов'])

  it('пустая ячейка читается как отсутствие значения', () => {
    expect(cell(['', ''], index, 'Название')).toBeNull()
    expect(cell(['   ', ''], index, 'Название')).toBeNull()
  })

  it('пробелы по краям обрезаются', () => {
    expect(cell(['  СПбГУТ  ', ''], index, 'Название')).toBe('СПбГУТ')
  })

  it('отсутствующая колонка даёт null, а не падение', () => {
    expect(cell(['СПбГУТ'], index, 'Сайт')).toBeNull()
  })
})

describe('числа из ячеек', () => {
  const index = mapHeaders(['Студентов'], ['Студентов'])

  it('пустая ячейка — это «Нет данных», а не ноль', () => {
    expect(numericCell([''], index, 'Студентов')).toEqual({ value: null })
  })

  it('ноль остаётся нулём', () => {
    expect(numericCell(['0'], index, 'Студентов')).toEqual({ value: 0 })
  })

  it('понимает пробелы-разделители разрядов', () => {
    expect(numericCell(['11 800'], index, 'Студентов')).toEqual({ value: 11800 })
  })

  it('нечисловое значение — ошибка строки, а не тихий ноль', () => {
    const result = numericCell(['много'], index, 'Студентов')
    expect('error' in result).toBe(true)
  })

  it('отрицательное и дробное отклоняются', () => {
    expect('error' in numericCell(['-5'], index, 'Студентов')).toBe(true)
    expect('error' in numericCell(['1.5'], index, 'Студентов')).toBe(true)
  })
})

describe('параметры загрузки', () => {
  it('по умолчанию это предпросмотр, а не запись', () => {
    expect(importQuerySchema.parse({ dataset: 'universities' }).mode).toBe('preview')
  })

  it('запись требует явного указания', () => {
    expect(importQuerySchema.parse({ dataset: 'programs', mode: 'apply' }).mode).toBe('apply')
  })

  it('неизвестный раздел отклоняется', () => {
    expect(importQuerySchema.safeParse({ dataset: 'cooperations' }).success).toBe(false)
  })

  it('неизвестный режим отклоняется', () => {
    expect(importQuerySchema.safeParse({ dataset: 'universities', mode: 'force' }).success).toBe(
      false,
    )
  })
})

describe('загрузка не стирает то, чего нет в файле', () => {
  it('колонка отсутствует — поле не трогаем; колонка пустая — очищаем', () => {
    // Разница принципиальная. «Колонки нет» значит «про это поле файл ничего
    // не говорит». «Колонка есть, ячейка пуста» значит «здесь нет данных» —
    // осознанное указание человека.
    const withColumn = mapHeaders(['Название', 'Студентов'], ['Название'], ['Студентов'])
    const withoutColumn = mapHeaders(['Название'], ['Название'], ['Студентов'])

    expect(withColumn.has('Студентов')).toBe(true)
    expect(withoutColumn.has('Студентов')).toBe(false)

    // При наличии колонки пустая ячейка читается как «нет данных».
    expect(numericCell(['Вуз', ''], withColumn, 'Студентов')).toEqual({ value: null })
  })
})

describe('повтор названия внутри одного файла', () => {
  it('второе вхождение — ошибка строки, а не второй вуз', () => {
    // Вуз опознаётся по названию. Два создания с одним названием ломают
    // опознание навсегда: повторная загрузка обновит произвольного двойника,
    // а программы привяжутся то к одному, то к другому.
    const seen = new Map<string, number>()
    const rows = ['Вуз А', 'Вуз Б', 'Вуз А']
    const outcomes = rows.map((name, index) => {
      const key = name.toLowerCase()
      if (seen.has(key)) return { line: index + 2, outcome: 'error', firstSeen: seen.get(key) }
      seen.set(key, index + 2)
      return { line: index + 2, outcome: 'create', firstSeen: null }
    })

    expect(outcomes.map((row) => row.outcome)).toEqual(['create', 'create', 'error'])
    expect(outcomes[2]?.firstSeen).toBe(2)
  })
})
