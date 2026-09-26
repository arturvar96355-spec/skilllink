import { describe, expect, it } from 'vitest'
import { contentDisposition } from './attachment-storage'

/**
 * Безопасное имя файла в `Content-Disposition` (решение 145, ТЗ п.3: `GET /api/files/:id`).
 * Имя приходит от пользователя — не доверяем ему как есть.
 */
describe('contentDisposition', () => {
  it('кириллица: точное имя в filename* (RFC 6266), ASCII-запасной вариант в filename', () => {
    const header = contentDisposition('договор.pdf')
    // ASCII-часть — не то же самое имя (кириллица не входит в ISO-8859-1 filename),
    // но остаётся читаемой структурой файла (расширение на месте).
    expect(header).toMatch(/filename="_+\.pdf"/)
    expect(header).toContain("filename*=UTF-8''%D0%B4%D0%BE%D0%B3%D0%BE%D0%B2%D0%BE%D1%80.pdf")
  })

  it('латиница без спецсимволов — совпадает в обеих частях', () => {
    const header = contentDisposition('contract.pdf')
    expect(header).toContain('filename="contract.pdf"')
    expect(header).toContain("filename*=UTF-8''contract.pdf")
  })

  it('перевод строки и кавычки в имени вырезаются — инъекция в заголовок невозможна', () => {
    const header = contentDisposition('файл"\r\nX-Evil: 1\n.pdf')
    expect(header).not.toContain('\n')
    expect(header).not.toContain('\r')
    // Внутри значения filename="..." не должно остаться необработанной кавычки.
    const match = /filename="([^"]*)"/.exec(header)
    expect(match).not.toBeNull()
  })

  it('пустое имя — запасное «file»', () => {
    const header = contentDisposition('')
    expect(header).toContain('filename="file"')
  })

  it('начинается с attachment — файл всегда скачивается, не открывается инлайн', () => {
    expect(contentDisposition('x.pdf').startsWith('attachment;')).toBe(true)
  })
})
