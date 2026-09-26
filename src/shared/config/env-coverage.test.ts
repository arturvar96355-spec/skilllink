import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Настройка, которую код читает, но `.env.example` не упоминает, существует только
 * для того, кто её написал.
 *
 * Обратное тоже проверяется: переменная в примере, которую никто не читает, —
 * это обещание настройки, которой нет.
 */

const ROOT = process.cwd()

/** Служебные переменные среды выполнения: их задаёт не человек. */
const RUNTIME = new Set(['NODE_ENV', 'NEXT_PHASE'])

/**
 * Переменные, которые читает не наш код, а библиотека или docker-compose.yml
 * (`${VAR}`, сверяется отдельно — src/shared/config/deploy-consistency.test.ts).
 * В исходниках их не найти, но описать их нужно: без AUTH_URL за HTTPS-прокси
 * next-auth после входа отправляет пользователя на localhost, PORT задаёт порт
 * сервера Next.js, POSTGRES_… и порты — только настройка контейнеров compose,
 * GRAFANA_… и PROMETHEUS_PORT — профиль `monitoring` (deploy/monitoring/README.md).
 */
const READ_BY_LIBRARIES = new Set([
  'AUTH_URL',
  'PORT',
  'POSTGRES_USER',
  'POSTGRES_PASSWORD',
  'POSTGRES_DB',
  'POSTGRES_PORT',
  'GRAFANA_ADMIN_PASSWORD',
  'PROMETHEUS_PORT',
  'GRAFANA_PORT',
])

function collectSources(directory: string, found: string[] = []): string[] {
  for (const entry of readdirSync(directory)) {
    if (entry === 'generated' || entry === 'node_modules' || entry === '.next') continue
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) collectSources(path, found)
    // Тесты настроек не задают, а примеры в их комментариях сканер принял бы
    // за настоящие имена переменных — в том числе в этом файле.
    else if (/\.tsx?$/.test(entry) && !entry.endsWith('.test.ts')) found.push(path)
  }
  return found
}

function usedNames(): Set<string> {
  const names = new Set<string>()
  const files = [
    ...collectSources(join(ROOT, 'src')),
    ...collectSources(join(ROOT, 'scripts')),
    ...collectSources(join(ROOT, 'prisma')),
  ]

  for (const file of files) {
    const content = readFileSync(file, 'utf8')
    // Прямое обращение: process.env.NAME
    for (const match of content.matchAll(/process\.env\.([A-Z_0-9]+)/g)) {
      names.add(match[1]!)
    }
    // Через хелперы: readBoolean('NAME'), readNumber('NAME'), readString('NAME')
    for (const match of content.matchAll(/read(?:Boolean|Number|String)\('([A-Z_0-9]+)'/g)) {
      names.add(match[1]!)
    }
  }

  // Скрипты сервера (scripts/deploy/*.sh, scripts/ops/*.sh) читают свои настройки
  // из .env.cloud хелпером env_get (offsite-lib.sh) или его обёрткой setting.
  // Приложение их не видит, но описаны они там же.
  for (const dir of [join(ROOT, 'scripts', 'deploy'), join(ROOT, 'scripts', 'ops')]) {
    for (const entry of readdirSync(dir)) {
      if (!entry.endsWith('.sh')) continue
      const content = readFileSync(join(dir, entry), 'utf8')
      for (const match of content.matchAll(/\b(?:env_get|setting) ([A-Z_0-9]+)/g)) {
        names.add(match[1]!)
      }
    }
  }

  for (const runtime of RUNTIME) names.delete(runtime)
  return names
}

/** Переменные из примера, включая закомментированные: они тоже документируют. */
function documentedNames(): Set<string> {
  const content = readFileSync(join(ROOT, '.env.example'), 'utf8')
  const names = new Set<string>()
  for (const line of content.split('\n')) {
    const match = /^#?\s*([A-Z_0-9]+)=/.exec(line.trim())
    if (match) names.add(match[1]!)
  }
  return names
}

describe('.env.example описывает настройки полностью', () => {
  const used = usedNames()
  const documented = documentedNames()

  it('переменные вообще нашлись', () => {
    expect(used.size).toBeGreaterThan(5)
    expect(documented.has('DATABASE_URL')).toBe(true)
  })

  it('каждая читаемая переменная описана', () => {
    const missing = [...used].filter((name) => !documented.has(name)).sort()
    expect(
      missing,
      `Код читает переменные, которых нет в .env.example: ${missing.join(', ')}. ` +
        'Настройка, о которой никто не знает, не настройка.',
    ).toEqual([])
  })

  it('в примере нет переменных, которых код не читает', () => {
    const unused = [...documented]
      .filter((name) => !used.has(name) && !READ_BY_LIBRARIES.has(name))
      .sort()
    expect(
      unused,
      `.env.example обещает настройки, которых нет в коде: ${unused.join(', ')}.`,
    ).toEqual([])
  })
})
