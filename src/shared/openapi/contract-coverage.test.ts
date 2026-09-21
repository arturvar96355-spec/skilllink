import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * По правилу проекта эндпоинт сначала описывается в docs/API_CONTRACT.md,
 * потом реализуется. На практике пять рабочих возможностей оказались нигде
 * не описаны — фронт про них просто не узнал бы.
 *
 * Этот тест требует, чтобы каждый маршрут упоминался в контракте.
 * Спецификацию OpenAPI сторожит openapi.test.ts — здесь речь о документе,
 * который читают люди.
 */

const API_DIR = join(process.cwd(), 'src/app/api')
const CONTRACT = join(process.cwd(), 'docs/API_CONTRACT.md')

/**
 * Перехватывающий маршрут NextAuth. Его отдельные адреса (`/api/auth/csrf`,
 * `/api/auth/callback/credentials`, `/api/auth/session`) описаны в разделе
 * аутентификации — сам файл-заглушка описывать нечего.
 */
const NOT_DESCRIBED_SEPARATELY = ['/api/auth/:...nextauth']

function collectRoutes(directory: string, prefix = '/api'): string[] {
  const found: string[] = []
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) {
      const segment = entry.startsWith('[') ? `:${entry.slice(1, -1)}` : entry
      found.push(...collectRoutes(path, `${prefix}/${segment}`))
    } else if (entry === 'route.ts') {
      found.push(prefix)
    }
  }
  return found
}

describe('контракт описывает все маршруты', () => {
  const contract = readFileSync(CONTRACT, 'utf8')
  const routes = collectRoutes(API_DIR).sort()

  it('маршруты вообще нашлись', () => {
    expect(routes.length).toBeGreaterThan(40)
  })

  for (const route of routes) {
    const shouldSkip = NOT_DESCRIBED_SEPARATELY.includes(route)

    it.skipIf(shouldSkip)(`${route} описан в API_CONTRACT.md`, () => {
      expect(
        contract.includes(route),
        `Маршрут ${route} не упоминается в docs/API_CONTRACT.md. ` +
          'Опишите его: фронт читает этот документ, а не код.',
      ).toBe(true)
    })
  }
})
