import { describe, expect, it } from 'vitest'
import {
  CSV_DELIMITER,
  UTF8_BOM,
  csvDate,
  escapeCsvValue,
  exportFileName,
  toCsv,
} from './export.rules'
import { exportQuerySchema } from './export.schema'

describe('экранирование ячейки CSV', () => {
  it('пустые значения дают пустую ячейку', () => {
    expect(escapeCsvValue(null)).toBe('')
    expect(escapeCsvValue(undefined)).toBe('')
  })

  it('логическое значение читается по-русски', () => {
    expect(escapeCsvValue(true)).toBe('да')
    expect(escapeCsvValue(false)).toBe('нет')
  })

  it('ноль остаётся нулём, а не превращается в пустоту', () => {
    expect(escapeCsvValue(0)).toBe('0')
  })

  it('нечисловое число не попадает в файл', () => {
    expect(escapeCsvValue(Number.NaN)).toBe('')
    expect(escapeCsvValue(Number.POSITIVE_INFINITY)).toBe('')
  })

  it('значение с разделителем берётся в кавычки', () => {
    expect(escapeCsvValue(`Москва${CSV_DELIMITER} Россия`)).toBe('"Москва; Россия"')
  })

  it('кавычки внутри значения удваиваются', () => {
    expect(escapeCsvValue('Вуз "Связь"')).toBe('"Вуз ""Связь"""')
  })

  it('перенос строки не разрывает строку файла', () => {
    expect(escapeCsvValue('Первая\nвторая')).toBe('"Первая\nвторая"')
  })

  it('значение, похожее на формулу, обезвреживается', () => {
    // Иначе выгрузка становится способом подсунуть формулу в чужую таблицу.
    expect(escapeCsvValue('=1+1')).toBe("'=1+1")
    expect(escapeCsvValue('+7 900 000-00-00')).toBe("'+7 900 000-00-00")
    expect(escapeCsvValue('-5')).toBe("'-5")
    expect(escapeCsvValue('@user')).toBe("'@user")
  })

  it('обычный текст не трогается', () => {
    expect(escapeCsvValue('СПбГУТ')).toBe('СПбГУТ')
  })
})

describe('сборка файла', () => {
  it('начинается с BOM: иначе Excel показывает кракозябры', () => {
    expect(toCsv(['Название'], [['СПбГУТ']]).startsWith(UTF8_BOM)).toBe(true)
  })

  it('строки разделены CRLF', () => {
    const csv = toCsv(['А', 'Б'], [['1', '2']])
    expect(csv).toContain('А;Б\r\n1;2\r\n')
  })

  it('пустой набор даёт файл с одними заголовками', () => {
    const csv = toCsv(['Название'], [])
    expect(csv).toBe(`${UTF8_BOM}Название\r\n`)
  })
})

describe('дата в выгрузке', () => {
  it('пустая дата даёт пустую ячейку', () => {
    expect(csvDate(null)).toBe('')
  })

  it('дата выводится в привычном виде', () => {
    expect(csvDate(new Date('2026-09-21T10:00:00.000Z'))).toContain('2026')
  })
})

describe('имя файла', () => {
  it('содержит раздел и дату', () => {
    const name = exportFileName('universities', new Date('2026-09-21T10:00:00.000Z'))
    expect(name).toBe('skilllink-universities-2026-09-21.csv')
  })
})

describe('параметры выгрузки', () => {
  it('требует указать раздел', () => {
    expect(exportQuerySchema.safeParse({}).success).toBe(false)
  })

  it('отклоняет неизвестный раздел', () => {
    expect(exportQuerySchema.safeParse({ dataset: 'everything' }).success).toBe(false)
  })

  it('ограничивает размер выгрузки', () => {
    expect(exportQuerySchema.safeParse({ dataset: 'universities', limit: '100000' }).success).toBe(
      false,
    )
  })

  it('подставляет ограничение по умолчанию', () => {
    expect(exportQuerySchema.parse({ dataset: 'programs' }).limit).toBe(1000)
  })
})
