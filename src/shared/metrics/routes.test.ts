import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { API_ROUTE_TEMPLATES, OTHER_ROUTE, routeTemplate } from './routes'

/**
 * Метка `route` — шаблон маршрута (решение 137). Список шаблонов ведётся руками,
 * поэтому первым делом он сверяется с файлами маршрутов.
 */

const API_DIR = join(process.cwd(), 'src/app/api')

function routeFiles(directory: string, prefix = '/api'): string[] {
  const found: string[] = []
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) found.push(...routeFiles(path, `${prefix}/${entry}`))
    else if (entry === 'route.ts') found.push(prefix)
  }
  return found
}

describe('список шаблонов совпадает с маршрутами', () => {
  it('каждый src/app/api/**/route.ts есть в API_ROUTE_TEMPLATES и наоборот', () => {
    const files = routeFiles(API_DIR).sort()
    const listed = [...API_ROUTE_TEMPLATES].sort()
    expect(
      listed,
      'Добавьте новый маршрут в src/shared/metrics/routes.ts — иначе в метриках он будет «other».',
    ).toEqual(files)
  })
})

describe('путь запроса → шаблон', () => {
  it.each([
    ['/api/universities', '/api/universities'],
    ['/api/universities/cm1abc', '/api/universities/[id]'],
    ['/api/universities/cm1abc/contacts/cm2def/legal-basis/history', '/api/universities/[id]/contacts/[contactId]/legal-basis/history'],
    ['/api/workflow/stages/s1/history', '/api/workflow/stages/[id]/history'],
    ['/api/calendar/secret-token.ics', '/api/calendar/[feed]'],
    ['/api/auth/session', '/api/auth/[...nextauth]'],
    ['/api/auth/callback/credentials', '/api/auth/[...nextauth]'],
    ['/api/metrics', '/api/metrics'],
  ])('%s → %s', (path, template) => {
    expect(routeTemplate(path)).toBe(template)
  })

  it('статический сегмент важнее динамического, как в Next', () => {
    // /api/skills/[id] тоже подходит, но есть отдельный маршрут.
    expect(routeTemplate('/api/skills/demand')).toBe('/api/skills/demand')
    expect(routeTemplate('/api/recommendations/generate')).toBe('/api/recommendations/generate')
  })

  it('неизвестное — одна метка other', () => {
    for (const path of ['/api/wp-admin', '/api/universities/1/2/3/4', '/api', '/api/%E0%A4%A', '/favicon.ico']) {
      expect(routeTemplate(path)).toBe(OTHER_ROUTE)
    }
  })

  it('кардинальность: тысяча разных id — одна метка шаблона', () => {
    const labels = new Set<string>()
    for (let index = 0; index < 1000; index += 1) {
      labels.add(routeTemplate(`/api/universities/c${index.toString(36).padStart(24, 'x')}`))
      labels.add(routeTemplate(`/api/no-such-thing-${index}`))
    }
    expect([...labels].sort()).toEqual(['/api/universities/[id]', OTHER_ROUTE])
  })
})
