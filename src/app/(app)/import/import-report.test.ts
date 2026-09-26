import { describe, expect, it } from 'vitest'
import type { ImportResultDto } from '@/shared/contracts'
import { encodingLabel, hasImportChanges, importSummaryText } from './import-report'

function result(patch: Partial<ImportResultDto> = {}): ImportResultDto {
  return {
    dataset: 'universities',
    encoding: 'utf-8',
    mode: 'preview',
    totalRows: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    unchanged: 0,
    errors: 0,
    rows: [],
    processedAt: '2026-09-26T10:00:00.000Z',
    ...patch,
  }
}

describe('encodingLabel', () => {
  it('windows-1251 подписывается словами, а не кодом', () => {
    expect(encodingLabel('windows-1251')).toBe('Windows-1251')
  })

  it('utf-8 подписывается как UTF-8', () => {
    expect(encodingLabel('utf-8')).toBe('UTF-8')
  })
})

describe('importSummaryText', () => {
  it('файл без изменений — отдельная фраза, а не «создастся 0»', () => {
    expect(importSummaryText(result({ totalRows: 5, unchanged: 0 }))).toBe(
      'Всего строк: 5. Файл не меняет реестр.',
    )
  })

  it('перечисляет только ненулевые счётчики', () => {
    expect(
      importSummaryText(result({ totalRows: 10, created: 3, updated: 2, errors: 1 })),
    ).toBe('Всего строк: 10. Создастся 3, обновится 2, ошибок 1.')
  })
})

describe('hasImportChanges', () => {
  it('есть изменения — создание или обновление', () => {
    expect(hasImportChanges(result({ created: 1 }))).toBe(true)
    expect(hasImportChanges(result({ updated: 1 }))).toBe(true)
  })

  it('нет изменений — только без изменений, пропуски или ошибки', () => {
    expect(hasImportChanges(result({ unchanged: 3, skipped: 1, errors: 2 }))).toBe(false)
  })
})
