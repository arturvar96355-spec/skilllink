import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { logoFor } from './university-logos'

/**
 * Решение 77 / 237: у каждой записи в LOGOS должен быть настоящий файл
 * в `public/logos/` (не 404 на бирке) и файл не должен раздуваться —
 * лимит из решения 237 — 150 КБ на файл.
 */
const SHORT_NAMES = [
  'СПбГУТ',
  'МТУСИ',
  'КНИТУ-КАИ',
  'НГТУ',
  'УрФУ',
  'ДГТУ',
  'БФУ им. И. Канта',
  'ВГУ',
  'ДВФУ',
  'ИРНИТУ',
  'Иннополис',
  'КубГТУ',
  'ННГУ',
  'ОмГТУ',
  'ПГУТИ',
  'ПНИПУ',
  'СФУ',
  'ТУСУР',
  'УУНиТ',
]

const MAX_LOGO_BYTES = 150 * 1024

describe('логотипы вузов (решение 77, 237)', () => {
  it.each(SHORT_NAMES)('у %s есть файл в public/logos и он не больше 150 КБ', (shortName) => {
    const logo = logoFor(shortName)
    expect(logo).not.toBeNull()
    const filePath = join(process.cwd(), 'public', logo!.src.replace(/^\//, ''))
    expect(existsSync(filePath)).toBe(true)
    expect(statSync(filePath).size).toBeLessThanOrEqual(MAX_LOGO_BYTES)
  })

  it('вуза без логотипа в списке — logoFor возвращает null', () => {
    expect(logoFor('Вуз, которого нет в LOGOS')).toBeNull()
    expect(logoFor(null)).toBeNull()
  })
})
