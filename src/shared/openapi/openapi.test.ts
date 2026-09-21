import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildOpenApiDocument } from './build'
import { ENDPOINTS, EXCLUDED_ROUTES } from './registry'

const API_ROOT = 'src/app/api'
const METHODS = ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'] as const

interface DiscoveredRoute {
  /** Путь файла относительно src/app/api, например `/universities/[id]/archive`. */
  routePath: string
  methods: string[]
}

/** Обходит каталог маршрутов и собирает, какие методы каждый из них экспортирует. */
async function discoverRoutes(directory = API_ROOT, prefix = ''): Promise<DiscoveredRoute[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const routes: DiscoveredRoute[] = []

  for (const entry of entries) {
    if (entry.isDirectory()) {
      routes.push(...(await discoverRoutes(join(directory, entry.name), `${prefix}/${entry.name}`)))
      continue
    }
    if (entry.name !== 'route.ts') continue

    const source = await readFile(join(directory, entry.name), 'utf8')
    const methods = METHODS.filter((method) =>
      new RegExp(`export const (\\{[^}]*\\b${method}\\b[^}]*\\}|${method}\\b)`).test(source),
    )
    routes.push({ routePath: prefix === '' ? '/' : prefix, methods })
  }

  return routes
}

/** `/universities/[id]/archive` → `/api/universities/{id}/archive` */
function toOpenApiPath(routePath: string): string {
  return `/api${routePath.replace(/\[([^\]]+)\]/g, (_match, name: string) => `{${name}}`)}`
}

describe('полнота спецификации OpenAPI', () => {
  it('каждый маршрут приложения описан в реестре', async () => {
    const discovered = await discoverRoutes()
    const described = new Set(ENDPOINTS.map((spec) => `${spec.method.toUpperCase()} ${spec.path}`))

    const missing: string[] = []
    for (const route of discovered) {
      if (EXCLUDED_ROUTES.includes(route.routePath)) continue
      for (const method of route.methods) {
        const key = `${method} ${toOpenApiPath(route.routePath)}`
        if (!described.has(key)) missing.push(key)
      }
    }

    // Если тест упал — в приложении появился маршрут, которого нет в спецификации.
    // Добавьте его в src/shared/openapi/registry.ts, иначе фронт о нём не узнает.
    expect(missing).toEqual([])
  })

  it('в реестре нет описаний несуществующих маршрутов', async () => {
    const discovered = await discoverRoutes()
    const real = new Set<string>()
    for (const route of discovered) {
      for (const method of route.methods) {
        real.add(`${method} ${toOpenApiPath(route.routePath)}`)
      }
    }

    const orphaned = ENDPOINTS.map(
      (spec) => `${spec.method.toUpperCase()} ${spec.path}`,
    ).filter((key) => !real.has(key))

    expect(orphaned).toEqual([])
  })
})

describe('сборка документа', () => {
  const document = buildOpenApiDocument('https://example.invalid')

  it('это OpenAPI 3.1', () => {
    expect(document.openapi).toBe('3.1.0')
  })

  it('указан адрес сервера', () => {
    expect(document.servers).toEqual([{ url: 'https://example.invalid' }])
  })

  it('пути собраны', () => {
    const paths = document.paths as Record<string, unknown>
    expect(Object.keys(paths).length).toBeGreaterThan(40)
    expect(paths['/api/universities']).toBeDefined()
  })

  it('операция несёт параметры пути', () => {
    const paths = document.paths as Record<string, Record<string, Record<string, unknown>>>
    const operation = paths['/api/universities/{id}']?.get
    const parameters = operation?.parameters as Array<{ name: string; in: string }>
    expect(parameters.some((item) => item.name === 'id' && item.in === 'path')).toBe(true)
  })

  it('фильтры списка развёрнуты в query-параметры', () => {
    const paths = document.paths as Record<string, Record<string, Record<string, unknown>>>
    const parameters = paths['/api/universities']?.get?.parameters as Array<{ name: string }>
    const names = parameters.map((item) => item.name)
    expect(names).toContain('page')
    expect(names).toContain('status')
  })

  it('тело запроса описано схемой из модуля', () => {
    const paths = document.paths as Record<string, Record<string, Record<string, unknown>>>
    const body = paths['/api/universities']?.post?.requestBody as {
      required: boolean
      content: Record<string, { schema: { properties: Record<string, unknown> } }>
    }
    expect(body.required).toBe(true)
    const properties = body.content['application/json']?.schema.properties ?? {}
    expect(Object.keys(properties)).toContain('name')
    expect(Object.keys(properties)).toContain('city')
  })

  it('необязательное тело помечено как необязательное', () => {
    const paths = document.paths as Record<string, Record<string, Record<string, unknown>>>
    const body = paths['/api/data-sources/sync']?.post?.requestBody as { required: boolean }
    expect(body.required).toBe(false)
  })

  it('ошибки описаны кодами состояния', () => {
    const paths = document.paths as Record<string, Record<string, Record<string, unknown>>>
    const responses = paths['/api/workflow/stages/{id}']?.patch?.responses as Record<string, unknown>
    // Недопустимый переход отдаёт 409 — он обязан быть в спецификации.
    expect(responses['409']).toBeDefined()
    expect(responses['422']).toBeDefined()
  })

  it('право доступа указано в описании операции', () => {
    const paths = document.paths as Record<string, Record<string, Record<string, unknown>>>
    const description = paths['/api/audit']?.get?.description as string
    expect(description).toContain('ADMIN')
  })
})
