import { globSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Прогон вёрстки на телефоне (`scripts/mobile-audit.mjs`, решение 219) проходит
 * по списку страниц. Новая страница, забытая в списке, осталась бы без проверки
 * горизонтальной прокрутки — поэтому список сверяется с папкой `src/app`.
 * Карточки (`[id]`) скрипт находит сам по первым записям из API.
 */
describe('прогон вёрстки на телефоне', () => {
  const script = readFileSync('scripts/mobile-audit.mjs', 'utf8')
  const listed = new Set([...script.matchAll(/^\s*'(\/[^']*)',$/gm)].map((match) => match[1]!.split('?')[0]!))

  const pages = globSync('src/app/**/page.tsx')
    .map((file) =>
      file
        .replace(/^src\/app/, '')
        .replace(/\/page\.tsx$/, '')
        .replace(/\/\([^)]+\)/g, ''),
    )
    .map((route) => route || '/')
    .filter((route) => !route.includes('['))
    // Вход скрипт открывает отдельно, до сессии.
    .filter((route) => route !== '/login')

  it('находит страницы', () => {
    expect(pages.length).toBeGreaterThan(20)
  })

  it('вход проверяется до сессии', () => {
    expect(script).toContain('/login')
  })

  it('страница сотрудника (решение 230) проверяется — своя, по учётной записи прогона', () => {
    expect(script).toContain('`/team/${id}`')
  })

  it.each(pages)('%s есть в списке прогона', (route) => {
    expect(listed.has(route), `добавьте «${route}» в STATIC_ROUTES скрипта`).toBe(true)
  })
})
