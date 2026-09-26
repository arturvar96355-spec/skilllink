import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Внутренние ссылки — только через next/link.
 *
 * ТЗ РТК, нефункциональные требования п. 2: страница не должна каждый раз
 * обновляться или сбрасываться. Обычный `<a href="/…">` перезагружает всё
 * приложение: сбрасывает фильтры, прокрутку и заново качает каркас. Внешние
 * адреса, `mailto:` и якоря на той же странице — законный `<a>`.
 *
 * Проверка по тексту: ловит `<a` с адресом от корня (`"/…"`, `` `/…` ``) или
 * из помощников ссылок (`universityHref(…)` и т. п. из ui/lib/links).
 */
const ROOTS = [join(process.cwd(), 'src', 'app'), join(process.cwd(), 'src', 'ui')]

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === 'api' ? [] : tsxFiles(path)
    return path.endsWith('.tsx') ? [path] : []
  })
}

const INTERNAL_ANCHOR = /<a\b[^>]*?\bhref=(?:"\/|\{`\/|\{[A-Za-z]+Href\(|\{ROUTES\.)/g

describe('внутренние ссылки', () => {
  for (const file of ROOTS.flatMap(tsxFiles)) {
    it(`${relative(process.cwd(), file)}: без <a> на свои страницы`, () => {
      const found = readFileSync(file, 'utf8').match(INTERNAL_ANCHOR) ?? []
      expect(found, 'замените <a> на Link из next/link').toEqual([])
    })
  }
})
