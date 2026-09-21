import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Обёртка обращается к `next/headers`, который вне запроса Next не работает,
 * поэтому поведение проверяется пробником на живом сервере. Здесь — то, что
 * можно проверить без запроса.
 */
describe('запрос к своему API с сервера', () => {
  const source = readFileSync(join(process.cwd(), 'src/shared/api/server-fetch.ts'), 'utf8')

  it('передаёт cookie пользователя', () => {
    expect(
      source.includes('cookie: cookieHeader'),
      'без передачи cookie серверный компонент покажет данные чужого пользователя',
    ).toBe(true)
  })

  it('НЕ берёт адрес из заголовков запроса', () => {
    // Первая версия брала адрес из X-Forwarded-Host. Подделав заголовок, можно
    // было заставить сервер отправить cookie пользователя на чужой хост —
    // проверено, запрос действительно уходил наружу. Заголовкам здесь не место.
    expect(source).not.toContain('x-forwarded-host')
    expect(source).not.toContain('x-forwarded-proto')
    expect(source).not.toMatch(/headers\(\)/)
    expect(source).not.toMatch(/\.get\('host'\)/)
  })

  it('идёт на себя по петлевому адресу, когда APP_BASE_URL не задан', () => {
    // Петлевой адрес увести никуда нельзя — это и есть защита.
    expect(source).toContain('127.0.0.1')
    expect(source).toContain('APP_BASE_URL')
  })

  it('не кеширует ответы по умолчанию', () => {
    // Иначе после действия пользователь увидит прежнее состояние
    // и решит, что оно не сохранилось.
    expect(source).toContain("cache: init.cache ?? 'no-store'")
  })
})
