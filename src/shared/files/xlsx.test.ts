import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AppError } from '@/shared/http/errors'
import { crc32, readZip, writeZip } from './zip'
import { columnIndex, columnName, decodeXml, escapeXml, readXlsx, writeXlsx } from './xlsx'
import {
  LMS_EDUCATION_LEVELS,
  LMS_GENDERS,
  LMS_USER_COLUMNS,
  buildLmsUsersFile,
} from '@/integrations/lms/lms-users-file'

const FIXTURES = join(process.cwd(), 'tests/fixtures')

describe('ZIP без зависимостей', () => {
  it('CRC-32 совпадает с эталоном IEEE', () => {
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926)
    expect(crc32(new Uint8Array(0))).toBe(0)
  })

  it('записанный архив читается обратно: имена в UTF-8, сжатие и хранение без сжатия', () => {
    const big = Buffer.from('повтор '.repeat(1000), 'utf8')
    const tiny = Buffer.from([1, 2, 3])
    const files = readZip(writeZip([
      { name: 'xl/лист.xml', data: big },
      { name: 'raw.bin', data: tiny },
      { name: 'empty.txt', data: new Uint8Array(0) },
    ]))
    expect(files.get('xl/лист.xml')?.equals(big)).toBe(true)
    expect(files.get('raw.bin')?.equals(tiny)).toBe(true)
    expect(files.get('empty.txt')?.length).toBe(0)
  })

  it('одинаковый вход — одинаковые байты: время в архиве постоянное', () => {
    const entries = [{ name: 'a.txt', data: Buffer.from('a') }]
    expect(writeZip(entries).equals(writeZip(entries))).toBe(true)
  })

  it('не ZIP — понятная ошибка проверки, а не падение', () => {
    expect(() => readZip(Buffer.from('это не архив, а просто текст достаточной длины'))).toThrow(AppError)
  })

  it('испорченные данные ловятся контрольной суммой', () => {
    const zip = writeZip([{ name: 'a.txt', data: Buffer.from('abcdef') }])
    // Данные без сжатия лежат сразу после 30 байт заголовка и имени «a.txt».
    zip[30 + 5] = 'X'.charCodeAt(0)
    expect(() => readZip(zip)).toThrow(/Файл не похож на книгу Excel/)
  })

  it('ZIP-бомба: распакованный объём сверх предела отклоняется', () => {
    const zip = writeZip([{ name: 'big.xml', data: Buffer.alloc(2 * 1024 * 1024, 0x41) }])
    expect(zip.length).toBeLessThan(20_000)
    expect(() => readZip(zip, { maxEntries: 10, maxTotalBytes: 1024 * 1024 })).toThrow(AppError)
  })
})

describe('XML и адреса ячеек', () => {
  it('колонки: A, Z, AA, AE — туда и обратно', () => {
    for (const [name, index] of [['A', 0], ['Z', 25], ['AA', 26], ['AE', 30], ['AZ', 51]] as const) {
      expect(columnIndex(name)).toBe(index)
      expect(columnName(index)).toBe(name)
    }
  })

  it('экранирование и сущности', () => {
    expect(escapeXml('ООО «А&Б» <x> "q"')).toBe('ООО «А&amp;Б» &lt;x&gt; &quot;q&quot;')
    expect(decodeXml('&lt;&gt;&amp;&quot;&apos;&#1071;&#x44F;')).toBe('<>&"\'Яя')
  })
})

describe('книга Excel: запись → чтение', () => {
  it('круговой тест: строки, числа, пропуски, спецсимволы, два листа', () => {
    const sheets = [
      {
        name: 'Лист1',
        rows: [
          ['Название', 'Число', 'Пусто', 'Текст'],
          ['ООО «Базис» & Ко <тест>', 79990234365, null, '=СУММ(A1:A2)'],
          ['  пробелы по краям ', 3.5, '', 'строка\nс переносом'],
        ],
        boldHeader: true,
      },
      { name: 'Справочник', rows: [['М'], ['Ж']] },
    ]
    const read = readXlsx(writeXlsx(sheets))
    expect(read.map((sheet) => sheet.name)).toEqual(['Лист1', 'Справочник'])
    expect(read[0]!.rows).toEqual([
      ['Название', 'Число', 'Пусто', 'Текст'],
      ['ООО «Базис» & Ко <тест>', '79990234365', '', '=СУММ(A1:A2)'],
      ['  пробелы по краям ', '3.5', '', 'строка\nс переносом'],
    ])
    expect(read[1]!.rows).toEqual([['М'], ['Ж']])
  })

  it('строка «=…» пишется текстом, а не формулой: внедрение формулы через xlsx невозможно', () => {
    const xml = readZip(writeXlsx([{ name: 'Лист1', rows: [['=HYPERLINK("http://x")']] }]))
      .get('xl/worksheets/sheet1.xml')!
      .toString('utf8')
    expect(xml).not.toContain('<f>')
    expect(xml).toContain('t="s"')
  })

  it('в свойствах файла нет автора: только название программы', () => {
    const files = readZip(writeXlsx([{ name: 'Лист1', rows: [['a']] }]))
    const core = files.get('docProps/core.xml')!.toString('utf8')
    expect(core).not.toContain('dc:creator')
    expect(core).not.toContain('lastModifiedBy')
    expect(files.get('docProps/app.xml')!.toString('utf8')).toContain('SkillLink')
  })

  it('читает синтетическую фикстуру в формате файла организаторов: общие строки, число, inlineStr, пустая строка', () => {
    const [sheet] = readXlsx(readFileSync(join(FIXTURES, 'vendors.sample.xlsx')))
    expect(sheet!.name).toBe('Лист1')
    expect(sheet!.rows[0]).toEqual(['Компания', 'Продукт', 'ФИО', 'Телефон', 'Почта', 'Способ связи'])
    expect(sheet!.rows[2]![1]).toBe('«Beta.Lake», «Beta.Store»')
    // Телефон, сохранённый числом, читается без экспоненты.
    expect(sheet!.rows[3]![3]).toBe('89000003344')
    // Ячейка-строка прямо в ячейке (inlineStr).
    expect(sheet!.rows[4]![5]).toBe('Чат в ТГ')
    // Строка 7 в файле пустая — на её месте пустой массив, нумерация строк не сбита.
    expect(sheet!.rows[6]).toEqual([])
    expect(sheet!.rows[7]![0]).toBe('ООО «Дельта»')
  })
})

describe('файл «Загрузка пользователей» для LMS', () => {
  const rows = [
    { lastName: 'Тестова', firstName: 'Алла', middleName: 'Борисовна', phoneDigits: '79000000101', email: 'testova@example.invalid' },
    { lastName: 'Без', firstName: 'Отчества', middleName: null, phoneDigits: null, email: 'bez@example.invalid' },
  ]
  const file = buildLmsUsersFile(rows)
  const [sheet1, sheet2] = readXlsx(file)

  it('заголовки — 30 колонок шаблона байт в байт, с его опечатками', () => {
    expect(LMS_USER_COLUMNS).toHaveLength(30)
    expect(sheet1!.rows[0]).toEqual([...LMS_USER_COLUMNS])
    expect(sheet1!.rows[0]![2]).toBe('Отчествопри наличии)')
    expect(sheet1!.rows[0]!.slice(19, 22)).toEqual([
      'Имядательный падеж)',
      'Фамилиядательный падеж)',
      'Отчестводательный падеж)',
    ])
  })

  it('Лист2 — справочники пола и образования, тире как в шаблоне', () => {
    expect(sheet2!.name).toBe('Лист2')
    expect(sheet2!.rows.map((row) => row[0] ?? '')).toEqual([...LMS_GENDERS, '', '', '', '', ''])
    expect(sheet2!.rows.map((row) => row[1])).toEqual([...LMS_EDUCATION_LEVELS])
    expect(LMS_EDUCATION_LEVELS[1]).toContain(' - ')
    expect(LMS_EDUCATION_LEVELS[4]).toContain(' – ')
  })

  it('заполнены только Фамилия, Имя, Отчество, телефон числом 7XXXXXXXXXX и почта', () => {
    expect(sheet1!.rows[1]).toEqual(['Тестова', 'Алла', 'Борисовна', '79000000101', 'testova@example.invalid'])
    expect(sheet1!.rows[2]).toEqual(['Без', 'Отчества', '', '', 'bez@example.invalid'])
    const xml = readZip(file).get('xl/worksheets/sheet1.xml')!.toString('utf8')
    expect(xml).toContain('<c r="D2"><v>79000000101</v></c>')
  })

  it('списки «Пол» и «Образование» ссылаются на Лист2, как в шаблоне', () => {
    const xml = readZip(file).get('xl/worksheets/sheet1.xml')!.toString('utf8')
    expect(xml).toContain('sqref="L1:L1001"><formula1>Лист2!$A$1:$A$2</formula1>')
    expect(xml).toContain('sqref="W1:W1001"><formula1>Лист2!$B$1:$B$7</formula1>')
  })
})
