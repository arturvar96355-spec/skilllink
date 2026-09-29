import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Подпись «единый вход для сотрудников РТК» под кнопкой Keycloak (#260, ревью 29.09,
 * P2-6): программа чтения с экрана должна слышать её вместе с кнопкой, как пояснение
 * у кнопок экспертов, а оформление — своё, не класс блока экспертов. Проверка по
 * тексту: тесты идут без браузера.
 */

const dir = join(process.cwd(), 'src/app/(auth)/login')
const form = readFileSync(join(dir, 'LoginForm.tsx'), 'utf8')
const css = readFileSync(join(dir, 'login.module.css'), 'utf8')

describe('вход: подпись единого входа', () => {
  it('кнопка Keycloak ссылается на подпись через aria-describedby', () => {
    // Текст кнопки в разметке (не в комментарии) и открывающий тег перед ним.
    const label = form.search(/>\s*Войти через Keycloak\s*</)
    const button = form.slice(form.lastIndexOf('<Button', label), label)
    const describedBy = button.match(/aria-describedby="([^"]+)"/)?.[1]
    expect(describedBy).toBeDefined()
    expect(form).toMatch(new RegExp(`<p id="${describedBy}"[^>]*>\\s*единый вход для сотрудников РТК`))
  })

  it('у каждой ссылки aria-describedby есть элемент с таким id', () => {
    for (const [, id] of form.matchAll(/aria-describedby="([^"]+)"/g)) {
      expect(form, id).toContain(`id="${id}"`)
    }
  })

  it('подпись оформлена своим классом, класс экспертов — только в блоке экспертов', () => {
    expect(form).toMatch(/className=\{styles\.ssoScope\}[^<]*единый вход для сотрудников РТК/)
    expect(form.match(/styles\.expertLoginScope/g)).toHaveLength(1)
    expect(css).toMatch(/\.ssoScope\s*\{/)
  })

  it('в стилях не осталось старого текста кнопки', () => {
    expect(css).not.toContain('Для сотрудников РТК')
  })
})
