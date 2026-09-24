import { describe, expect, it } from 'vitest'
import { AppError } from '@/shared/http/errors'
import {
  COOPERATION_STATUS_LABELS,
  DATA_ORIGIN_LABELS,
  PROGRAM_STATUS_LABELS,
  SKILL_LEVEL_LABELS,
  STAGE_STATUS_LABELS,
} from '@/shared/contracts/labels'
import type { ProgramRatingDto, UniversityRatingDto } from '@/shared/contracts/rating'
import {
  CSV_DELIMITER,
  UTF8_BOM,
  csvDate,
  csvLabel,
  escapeCsvValue,
  exportFileName,
  programRatingCells,
  toCsv,
  universityRatingCells,
} from './export.rules'
import { exportQuerySchema, parseExportRequest } from './export.schema'

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

describe('числа для русского Excel', () => {
  it('дробная часть — через запятую', () => {
    expect(escapeCsvValue(61.3)).toBe('61,3')
    expect(escapeCsvValue(0.456)).toBe('0,456')
  })

  it('целые не меняются', () => {
    expect(escapeCsvValue(7500)).toBe('7500')
  })

  it('запятая в числе не ломает строку: разделитель — точка с запятой', () => {
    expect(toCsv(['Рейтинг', 'Заявки'], [[61.3, 40]])).toContain('Рейтинг;Заявки\r\n61,3;40\r\n')
  })
})

describe('перечисления словами', () => {
  it('код заменяется подписью из общего словаря', () => {
    expect(csvLabel(COOPERATION_STATUS_LABELS, 'ACTIVE')).toBe('В работе')
    expect(csvLabel(STAGE_STATUS_LABELS, 'IN_PROGRESS')).toBe('В работе')
    expect(csvLabel(DATA_ORIGIN_LABELS, 'MOCK')).toBe('демонстрационные данные')
    expect(csvLabel(SKILL_LEVEL_LABELS, 'INTERMEDIATE')).toBe('Средний')
    expect(csvLabel(PROGRAM_STATUS_LABELS, 'ACTIVE')).toBe('Действует')
  })

  it('пустое значение остаётся пустым', () => {
    expect(csvLabel(STAGE_STATUS_LABELS, null)).toBeNull()
    expect(csvLabel(STAGE_STATUS_LABELS, undefined)).toBeNull()
  })
})

describe('рейтинг в выгрузке', () => {
  const factor = (normalized: number | null) => ({
    key: 'applicationCount' as const,
    title: 'Заявки на обучение',
    value: normalized === null ? null : 10,
    normalized,
    weight: 0.4,
    contribution: null,
  })

  it('программа: балл, основание и число учтённых показателей', () => {
    const rating: ProgramRatingDto = {
      programId: 'p1',
      score: 61.3,
      basis: 'estimate',
      explanation: '',
      factors: [factor(0.5), factor(null), factor(0.7)],
    }
    expect(programRatingCells(rating)).toEqual([61.3, 'Оценка', 2])
  })

  it('нет данных — пустой балл, а не ноль', () => {
    expect(programRatingCells(undefined)).toEqual([null, 'Нет данных', 0])
    const empty: ProgramRatingDto = {
      programId: 'p1',
      score: null,
      basis: 'none',
      explanation: '',
      factors: [factor(null), factor(null), factor(null)],
    }
    expect(programRatingCells(empty)).toEqual([null, 'Нет данных', 0])
  })

  it('вуз: балл, основание и число программ с баллом', () => {
    const rating: UniversityRatingDto = {
      universityId: 'u1',
      score: 48.5,
      basis: 'actual',
      explanation: '',
      programCount: 3,
      ratedProgramCount: 2,
      topProgram: null,
    }
    expect(universityRatingCells(rating)).toEqual([48.5, 'Фактические данные', 2])
    expect(universityRatingCells(null)).toEqual([null, 'Нет данных', 0])
  })
})

describe('фильтры выгрузки', () => {
  const request = (query: string) => new Request(`http://localhost/api/export?${query}`)

  it('связки принимают фильтры реестра', () => {
    const parsed = parseExportRequest(
      request('dataset=cooperations&q=СПбГУТ&status=ACTIVE&onlyBlocked=true&sort=-targetDate'),
    )
    expect(parsed.dataset).toBe('cooperations')
    if (parsed.dataset !== 'cooperations') return
    expect(parsed.filters).toMatchObject({
      q: 'СПбГУТ',
      status: ['ACTIVE'],
      onlyBlocked: true,
      sort: '-targetDate',
    })
    expect(parsed.limit).toBe(1000)
  })

  it('вузы принимают поиск, статус, регион и порог рейтинга', () => {
    const parsed = parseExportRequest(
      request('dataset=universities&q=связи&status=ACTIVE&region=Москва&minRating=50&limit=200'),
    )
    if (parsed.dataset !== 'universities') throw new Error('ожидались вузы')
    expect(parsed.limit).toBe(200)
    expect(parsed.filters).toMatchObject({
      q: 'связи',
      status: ['ACTIVE'],
      region: ['Москва'],
      minRating: 50,
    })
  })

  it('программы сохраняют прежний отбор по вузу', () => {
    const parsed = parseExportRequest(request('dataset=programs&universityId=u1&level=MASTER'))
    if (parsed.dataset !== 'programs') throw new Error('ожидались программы')
    expect(parsed.filters).toMatchObject({ universityId: 'u1', level: ['MASTER'] })
  })

  it('кривой фильтр — ошибка проверки, а не выгрузка всего', () => {
    expect(() => parseExportRequest(request('dataset=cooperations&status=WHATEVER'))).toThrowError(
      AppError,
    )
  })

  it('без фильтров выгружается всё, как раньше', () => {
    const parsed = parseExportRequest(request('dataset=skill-gaps'))
    expect(parsed).toEqual({ dataset: 'skill-gaps', limit: 1000 })
  })
})
