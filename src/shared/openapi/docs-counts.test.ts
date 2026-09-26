import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Документы разъезжаются тихо: маршрут добавили, README поправить забыли.
 * К моменту передачи команде одно и то же число было написано в четырёх местах
 * четырьмя разными значениями.
 *
 * Тест считает маршруты и операции по коду и требует, чтобы любое такое число
 * в документах совпадало с действительностью.
 */

const API_DIR = join(process.cwd(), 'src/app/api')
const OPENAPI = join(process.cwd(), 'docs/openapi.json')
const SCHEMA = join(process.cwd(), 'prisma/schema.prisma')
const MIGRATIONS_DIR = join(process.cwd(), 'prisma/migrations')
const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete']

function countRouteFiles(directory: string): number {
  let total = 0
  for (const entry of readdirSync(directory)) {
    // `[...unknown]` — не эндпоинт, а ответ JSON-ошибкой на опечатку в адресе.
    // В число маршрутов он не входит, иначе документы обещали бы на один
    // эндпоинт больше, чем есть. `[...nextauth]` считается: за ним настоящие
    // адреса входа, выхода и сессии.
    if (entry === '[...unknown]') continue
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) total += countRouteFiles(path)
    else if (entry === 'route.ts') total += 1
  }
  return total
}

function countOperations(): number {
  const spec = JSON.parse(readFileSync(OPENAPI, 'utf8')) as {
    paths: Record<string, Record<string, unknown>>
  }
  return Object.values(spec.paths).reduce(
    (sum, methods) => sum + Object.keys(methods).filter((key) => HTTP_METHODS.includes(key)).length,
    0,
  )
}

/** Модели схемы Prisma — по строкам `model Имя {`, без перечислений. */
function countModels(): number {
  const schema = readFileSync(SCHEMA, 'utf8')
  return [...schema.matchAll(/^model\s+\w+\s*\{/gm)].length
}

/** Папки миграций в prisma/migrations, без служебного migration_lock.toml. */
function countMigrations(): number {
  return readdirSync(MIGRATIONS_DIR).filter(
    (entry) => statSync(join(MIGRATIONS_DIR, entry)).isDirectory(),
  ).length
}

function collectDocs(): string[] {
  const docsDir = join(process.cwd(), 'docs')
  return [
    join(process.cwd(), 'README.md'),
    ...readdirSync(docsDir)
      .filter((name) => name.endsWith('.md'))
      .map((name) => join(docsDir, name)),
  ]
}

describe('числа в документации соответствуют коду', () => {
  const routeCount = countRouteFiles(API_DIR)
  const operationCount = countOperations()

  it('маршрутов больше сорока — иначе считалка сломалась, а не код', () => {
    expect(routeCount).toBeGreaterThan(40)
    expect(operationCount).toBeGreaterThanOrEqual(routeCount)
  })

  for (const file of collectDocs()) {
    const name = file.split('/').slice(-1)[0]!
    const content = readFileSync(file, 'utf8')

    it(`${name}: утверждения о числе маршрутов и операций верны`, () => {
      const claims = [...content.matchAll(/(\d+)\s+(маршрут|операци|эндпоинт)[а-яё]*/gi)]

      for (const claim of claims) {
        const declared = Number(claim[1])
        const word = claim[2]!.toLowerCase()
        const expected = word.startsWith('операци') ? operationCount : routeCount

        expect(
          declared,
          `${name}: «${claim[0]}» — в коде ${expected}. ` +
            'Поправьте документ или пересчитайте, но не оставляйте расхождение.',
        ).toBe(expected)
      }
    })
  }
})

/**
 * Модели/таблицы и миграции — та же проверка, что выше для маршрутов и операций,
 * но только по документам, которые описывают *текущее* состояние: README, PROGRESS
 * и DATABASE_ANSWERS. TECHNICAL_DECISIONS.md и DECISIONS.md — журналы решений: там
 * число «на момент такого-то решения» законно расходится с сегодняшним и переписывать
 * его — переписывать историю. У этих трёх документов такого оправдания нет:
 * они читаются как «сейчас в системе».
 */
describe('число моделей и миграций в ключевых документах соответствует коду', () => {
  const modelCount = countModels()
  const migrationCount = countMigrations()
  const CURRENT_STATE_DOCS = ['README.md', 'PROGRESS.md', 'DATABASE_ANSWERS.md']

  it('моделей и миграций вообще нашлось — иначе считалка сломалась, а не код', () => {
    expect(modelCount).toBeGreaterThan(20)
    expect(migrationCount).toBeGreaterThan(10)
  })

  for (const file of collectDocs().filter((path) => CURRENT_STATE_DOCS.includes(path.split('/').slice(-1)[0]!))) {
    const name = file.split('/').slice(-1)[0]!
    const content = readFileSync(file, 'utf8')

    it(`${name}: утверждения о числе моделей/таблиц и миграций верны`, () => {
      const claims = [...content.matchAll(/(\d+)\s+(модел[а-яё]*|миграци[а-яё]*)/gi)]

      for (const claim of claims) {
        const declared = Number(claim[1])
        const word = claim[2]!.toLowerCase()
        const expected = word.startsWith('миграци') ? migrationCount : modelCount

        expect(
          declared,
          `${name}: «${claim[0]}» — в коде ${expected}. ` +
            'Поправьте документ или пересчитайте, но не оставляйте расхождение.',
        ).toBe(expected)
      }
    })
  }
})
