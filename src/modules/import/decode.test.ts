import { describe, expect, it } from 'vitest'

import { decodeCsv } from './decode'

const HEADER = 'Название;Краткое название;Город;Регион;Статус'
const ROW = 'Ёлкинский институт связи;ЁИС;Орёл;Орловская область;NEW'
const CSV = `${HEADER}\n${ROW}\n`

/** Windows-1251 без внешних зависимостей: у кириллицы там сплошной диапазон. */
function toWindows1251(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length)
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index)
    if (code < 0x80) bytes[index] = code
    else if (code === 0x401) bytes[index] = 0xa8 // Ё
    else if (code === 0x451) bytes[index] = 0xb8 // ё
    else if (code >= 0x410 && code <= 0x44f) bytes[index] = code - 0x410 + 0xc0
    else throw new Error(`нет в Windows-1251: ${text[index]}`)
  }
  return bytes
}

describe('кодировка загружаемого файла', () => {
  it('UTF-8 читается как UTF-8', () => {
    const result = decodeCsv(new TextEncoder().encode(CSV))
    expect(result.encoding).toBe('utf-8')
    expect(result.text).toBe(CSV)
  })

  it('файл из Excel в Windows читается правильно', () => {
    // Раньше он декодировался как UTF-8, заголовки превращались в мусор,
    // и система отвечала «Не найдены: Название, Город, Регион».
    const result = decodeCsv(toWindows1251(CSV))
    expect(result.encoding).toBe('windows-1251')
    expect(result.text).toBe(CSV)
    expect(result.text).toContain('Ёлкинский институт связи')
    expect(result.text).toContain('Орёл')
  })

  it('UTF-8 с BOM остаётся UTF-8 — наша же выгрузка', () => {
    const result = decodeCsv(new TextEncoder().encode(`﻿${CSV}`))
    expect(result.encoding).toBe('utf-8')
  })

  it('латиница читается как UTF-8: путать не с чем', () => {
    expect(decodeCsv(new TextEncoder().encode('Name;City\nSPb;SPb\n')).encoding).toBe('utf-8')
  })

  it('UTF-16 отвергается с внятным сообщением, а не читается мусором', () => {
    const utf16 = new Uint8Array([0xff, 0xfe, 0x1d, 0x04, 0x30, 0x04])
    expect(() => decodeCsv(utf16)).toThrowError(/UTF-16/)
  })

  it('пустой файл не ломает определение', () => {
    expect(decodeCsv(new Uint8Array()).encoding).toBe('utf-8')
  })

  it('двоичный файл — понятный отказ, а не «не найдены колонки» или внутренняя ошибка', () => {
    // Нулевой байт есть в .xlsx и UTF-16 без метки; база символ с кодом 0 не примет.
    const bytes = new TextEncoder().encode(`${HEADER}\nЁлкин\u0000ский;ЁИС;Орёл;Орловская область;NEW\n`)
    expect(() => decodeCsv(bytes)).toThrow('Файл не похож на текстовый CSV')
  })
})
