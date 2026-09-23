import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { countSchema } from '@/shared/zod'
import { PG_INT_MAX, findNul } from './storable'

describe('символ с кодом 0', () => {
  it('находится в строке, в массиве и во вложенном объекте — с путём поля', () => {
    expect(findNul('a\u0000b')).toBe('_')
    expect(findNul({ name: 'Вуз', contacts: [{ fullName: 'ok' }, { fullName: 'x\u0000' }] })).toBe(
      'contacts.1.fullName',
    )
  })

  it('в ключе объекта — тоже', () => {
    expect(findNul({ metrics: { 'a\u0000': 1 } })).toBe('metrics')
  })

  it('обычные данные проходят', () => {
    expect(findNul({ name: 'Вуз', count: 5, flag: true, empty: null, list: ['а', 'б'] })).toBeNull()
  })
})

describe('количество для колонки Int', () => {
  it('принимает предел колонки и отказывает сверх него', () => {
    expect(countSchema().safeParse(PG_INT_MAX).success).toBe(true)
    expect(countSchema().safeParse(PG_INT_MAX + 1).success).toBe(false)
    expect(countSchema().safeParse(99_999_999_999).success).toBe(false)
  })
})

/**
 * Сторож: целое из запроса — с верхней границей.
 *
 * `z.number().int()` без `.max()` пропускает до 2^53, колонка `Int` вмещает
 * 2^31 − 1, а день просрочки в миллисекундах превращается в несуществующую дату.
 * Обе ошибки доходили до базы и отвечали 500. Количества — через `countSchema()`.
 */
describe('схемы входа', () => {
  const schemaFiles = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory()
        ? schemaFiles(join(dir, entry.name))
        : entry.name.endsWith('.schema.ts')
          ? [join(dir, entry.name)]
          : [],
    )

  it('ни одного целого без верхней границы', () => {
    const offenders = schemaFiles('src/modules').flatMap((file) =>
      readFileSync(file, 'utf8')
        .split('\n')
        .map((line, index) => ({ line, at: `${file}:${index + 1}` }))
        .filter(({ line }) => /number\(\)\.int\(\)/.test(line) && !/\.max\(/.test(line))
        .map(({ at, line }) => `${at}  ${line.trim()}`),
    )
    expect(offenders).toEqual([])
  })
})
