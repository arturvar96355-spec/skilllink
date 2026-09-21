import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Обёртка обращается к `next/headers`, который вне запроса Next не работает,
 * поэтому поведение проверяется пробником на живом сервере. Здесь — то, что
 * можно проверить без запроса: обёртка действительно передаёт cookie и не
 * потеряла эту строку при правке.
 */
describe('запрос к своему API с сервера', () => {
  const source = readFileSync(join(process.cwd(), 'src/shared/api/server-fetch.ts'), 'utf8')

  it('передаёт cookie пользователя', () => {
    expect(
      source.includes('cookie: cookieHeader'),
      'без передачи cookie серверный компонент покажет данные чужого пользователя',
    ).toBe(true)
  })

  it('берёт адрес из заголовков запроса, а не только из настройки', () => {
    // Иначе страница сломается на любом порту, кроме 3000, и за обратным прокси.
    expect(source).toContain('x-forwarded-host')
    expect(source).toContain("headerList.get('host')")
  })

  it('не кеширует ответы по умолчанию', () => {
    // Иначе после действия пользователь увидит прежнее состояние
    // и решит, что оно не сохранилось.
    expect(source).toContain("cache: init.cache ?? 'no-store'")
  })
})
