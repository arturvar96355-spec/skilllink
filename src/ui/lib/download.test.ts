import { describe, expect, it } from 'vitest'
import { filenameFromDisposition } from './api'

/** Имя скачанного файла — то, что покажет сообщение «Файл … скачан». */
describe('filenameFromDisposition', () => {
  it('обычное имя в кавычках — как отдаёт /api/export', () => {
    expect(filenameFromDisposition('attachment; filename="cooperations-2026-09-26.csv"', 'x.csv')).toBe(
      'cooperations-2026-09-26.csv',
    )
  })

  it('русское имя в filename* берётся раньше запасного ASCII-имени', () => {
    const header = `attachment; filename="report.xlsx"; filename*=UTF-8''${encodeURIComponent('Отчёт по ТЗ.xlsx')}`
    expect(filenameFromDisposition(header, 'x.xlsx')).toBe('Отчёт по ТЗ.xlsx')
  })

  it('без заголовка или с кривой кодировкой — запасное имя, а не пустота', () => {
    expect(filenameFromDisposition(null, 'report.csv')).toBe('report.csv')
    expect(filenameFromDisposition("attachment; filename*=UTF-8''%E0%A4%A", 'report.csv')).toBe('report.csv')
  })
})

describe('saveBlob (решение 210, S10)', () => {
  it('ссылка на файл живёт минуты, а не секунду: Safari на iPhone читает её после «Загрузить?»', async () => {
    const { saveBlob, DOWNLOAD_URL_TTL_MS } = await import('./api')
    const clicked: Array<{ href: string; download: string }> = []
    const link = {
      href: '',
      download: '',
      rel: '',
      click() {
        clicked.push({ href: this.href, download: this.download })
      },
      remove() {},
    }
    const timers: Array<{ ms: number; fn: () => void }> = []
    const revoked: string[] = []
    const fakeDocument = { createElement: () => link, body: { append: () => {} } } as unknown as Document
    saveBlob(new Blob(['x']), 'Отчёт.xlsx', {
      document: fakeDocument,
      url: { createObjectURL: () => 'blob:1', revokeObjectURL: (url: string) => void revoked.push(url) },
      setTimeout: (fn, ms) => timers.push({ fn, ms }),
    })

    expect(clicked).toEqual([{ href: 'blob:1', download: 'Отчёт.xlsx' }])
    expect(revoked).toEqual([])
    expect(timers).toHaveLength(1)
    expect(timers[0]!.ms).toBe(DOWNLOAD_URL_TTL_MS)
    expect(DOWNLOAD_URL_TTL_MS).toBeGreaterThanOrEqual(60_000)
    timers[0]!.fn()
    expect(revoked).toEqual(['blob:1'])
  })
})
