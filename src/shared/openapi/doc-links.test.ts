import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { dirname, join, normalize } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Ссылка между документами, которая никуда не ведёт, — мелочь ровно до того
 * момента, пока по ней не кликнул человек, которому этот документ прислали.
 * Одна такая уже была: README ссылался на SECURITY_LIMITATIONS.md в корне,
 * а файл лежит в docs/.
 */
describe('ссылки между документами ведут на существующие файлы', () => {
  const files = [
    'README.md',
    ...readdirSync(join(process.cwd(), 'docs'))
      .filter((name) => name.endsWith('.md'))
      .map((name) => join('docs', name)),
  ]

  for (const file of files) {
    it(`${file}: все ссылки на файлы разрешаются`, () => {
      const content = readFileSync(join(process.cwd(), file), 'utf8')
      const broken: string[] = []

      for (const match of content.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)) {
        const target = (match[2] ?? '').split('#')[0]
        if (!target || /^(https?:|mailto:)/.test(target)) continue

        const resolved = normalize(join(dirname(join(process.cwd(), file)), target))
        if (!existsSync(resolved)) broken.push(`[${match[1]}](${target})`)
      }

      expect(broken, `${file}: ссылки ведут в никуда`).toEqual([])
    })
  }
})
