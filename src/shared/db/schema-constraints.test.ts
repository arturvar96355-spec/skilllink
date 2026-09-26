import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { DOCUMENT_SORT_FIELDS } from '@/modules/documents/documents.schema'
import { PRODUCT_SORT_FIELDS } from '@/modules/products/products.schema'
import { PROGRAM_SORT_FIELDS } from '@/modules/programs/programs.schema'
import { SKILL_SORT_FIELDS } from '@/modules/skills/skills.schema'
import { UNIVERSITY_SORT_FIELDS } from '@/modules/universities/universities.schema'

/**
 * Ограничения, которые нельзя выразить в схеме Prisma, живут только в SQL
 * миграции. Такое легко потерять при следующей правке схемы: Prisma про них
 * не знает и не напомнит.
 *
 * Здесь проверяется, что они не исчезли из миграций и что схема о них
 * упоминает — чтобы следующий читатель искал их там, где они есть.
 */
describe('ограничения схемы, которые живут только в SQL миграций', () => {
  const migrations = readdirSync(join(process.cwd(), 'prisma/migrations'))
    .filter((name) => !name.endsWith('.toml'))
    .map((name) => readFileSync(join(process.cwd(), 'prisma/migrations', name, 'migration.sql'), 'utf8'))
    .join('\n')

  const schema = readFileSync(join(process.cwd(), 'prisma/schema.prisma'), 'utf8')

  it('основной контакт у вуза только один', () => {
    // Приложение это не обеспечивает: карточка берёт первый найденный.
    expect(migrations).toContain('contacts_one_primary_per_university')
    expect(migrations).toMatch(/ON "contacts"\("university_id"\)\s+WHERE "is_primary"/)
  })

  it('схема упоминает частичный индекс — иначе его не найти', () => {
    expect(schema).toContain('contacts_one_primary_per_university')
  })

  it('регион входит в уникальность рыночных данных', () => {
    // Без региона второй замер того же навыка по другому региону
    // не записался бы вовсе.
    expect(schema).toMatch(/@@unique\(\[skillId, period, source, region\]\)/)
  })

  it('регион обязателен: NULL-ы в ключе считаются различными', () => {
    expect(schema).toMatch(/region\s+String\s+@default\("Россия"\)/)
  })

  it('индексы под реальные запросы на месте', () => {
    expect(schema).toMatch(/@@index\(\[objectType, objectId\]\)/)
    expect(schema).toMatch(/@@index\(\[cooperationId\]\)/)
    expect(schema).toMatch(/@@index\(\[responsibleId\]\)/)
  })

  it('статистика правил рекомендаций: успехов не больше показов (решение 119)', () => {
    // successes_eff ≤ trials_eff держит запись (GREATEST в upsert); CHECK — страховка.
    expect(migrations).toContain('recommendation_rule_stats_counts_check')
    expect(migrations).toMatch(/"successes_eff" <= "trials_eff"/)
    expect(migrations).toContain('recommendation_rule_stats_scope_type_check')
    expect(schema).toContain('recommendation_rule_stats_counts_check')
    expect(schema).toMatch(/@@id\(\[ruleType, scopeType, scopeId\]\)/)
  })

  it('миграция подставляет регион до NOT NULL', () => {
    // Иначе она упадёт на любой базе, где есть замеры без региона.
    const index = migrations.indexOf('SET NOT NULL')
    const backfill = migrations.indexOf("SET \"region\" = 'Россия' WHERE \"region\" IS NULL")
    expect(backfill).toBeGreaterThan(-1)
    expect(backfill).toBeLessThan(index)
  })

  it('решение 134: слитый вуз — только архивный и не на себя', () => {
    // Prisma не умеет CHECK на комбинацию своих же полей — только SQL миграция.
    expect(migrations).toContain('universities_merged_into_check')
    expect(migrations).toMatch(/"merged_into_id" <> "id" AND "archived_at" IS NOT NULL/)
  })

  it('решение 134: пара «не дубль» хранится упорядоченной', () => {
    // Иначе «A, B» и «B, A» были бы двумя разными исключениями из поиска дублей.
    expect(migrations).toContain('duplicate_dismissals_order_check')
    expect(migrations).toMatch(/"first_id" < "second_id"/)
  })

  it('решение 134: вуз не может быть слит сам с собой, отмена слияния всегда с датой', () => {
    expect(migrations).toContain('university_merges_distinct_check')
    expect(migrations).toContain('university_merges_undone_check')
  })

  it('решение 134: ИНН и ОГРН вуза — ровно нужное число цифр', () => {
    // Контрольную цифру CHECK не проверяет (нечитаемое выражение) — это делает
    // src/shared/validation/inn-ogrn.ts на вводе; здесь только длина и что это цифры.
    expect(migrations).toMatch(/"inn" ~ '\^\[0-9\]\{10\}\$'/)
    expect(migrations).toMatch(/"ogrn" ~ '\^\[0-9\]\{13\}\$'/)
  })

  it('решение 134: схема упоминает CHECK-ограничения вуза — иначе их не найти при следующей правке', () => {
    expect(schema).toContain('CHECK в базе: NULL или ровно 10 цифр')
    expect(schema).toContain('CHECK: не на себя; только у архивной записи')
  })
})

/**
 * Порядок строк по умолчанию задаётся локалью кластера PostgreSQL и на разных
 * машинах разный: на macOS кириллица сортируется почти случайно, в образе
 * postgres:16-alpine — по кодам символов. Поэтому колонкам, по которым API
 * сортирует списки, задана ICU-сортировка в миграции.
 *
 * Проверяется и обратное: состав полей сортировки зафиксирован. Если появится
 * новое текстовое поле, тест упадёт — и это повод задать ему сортировку тоже.
 */
describe('русская сортировка списков', () => {
  const migrations = readdirSync(join(process.cwd(), 'prisma/migrations'))
    .filter((name) => !name.endsWith('.toml'))
    .map((name) => readFileSync(join(process.cwd(), 'prisma/migrations', name, 'migration.sql'), 'utf8'))
    .join('\n')

  const collated: Array<[string, string]> = [
    ['universities', 'name'],
    ['universities', 'city'],
    ['universities', 'region'],
    ['educational_programs', 'name'],
    ['it_products', 'name'],
    ['it_products', 'category'],
    ['skills', 'name'],
    ['skills', 'category'],
    ['documents', 'title'],
    ['contacts', 'full_name'],
    ['users', 'full_name'],
    ['data_sources', 'name'],
  ]

  /**
   * Все команды ALTER TABLE по этой таблице из всех миграций — каждая от своего
   * начала до точки с запятой. Таблица могла меняться и раньше, поэтому нельзя
   * брать первую попавшуюся, и нельзя искать в тексте дальше конца команды:
   * там уже другие таблицы с колонками того же имени.
   */
  function alterStatements(table: string): string[] {
    const statements: string[] = []
    const marker = `ALTER TABLE "${table}"`
    let from = migrations.indexOf(marker)
    while (from !== -1) {
      const end = migrations.indexOf(';', from)
      statements.push(migrations.slice(from, end === -1 ? undefined : end))
      from = migrations.indexOf(marker, from + marker.length)
    }
    return statements
  }

  it.each(collated)('%s.%s сортируется по-русски', (table, column) => {
    const pattern = new RegExp(`ALTER COLUMN "${column}"\\s+TYPE TEXT COLLATE "ru-x-icu"`)
    expect(alterStatements(table).some((statement) => pattern.test(statement))).toBe(true)
  })

  it('состав полей сортировки не менялся', () => {
    expect(UNIVERSITY_SORT_FIELDS).toEqual(['name', 'city', 'region', 'status', 'createdAt', 'updatedAt'])
    expect(PROGRAM_SORT_FIELDS).toEqual([
      'name', 'level', 'status', 'applicationCount', 'studentCount', 'groupCount', 'createdAt', 'updatedAt',
    ])
    expect(PRODUCT_SORT_FIELDS).toEqual(['name', 'category', 'status', 'updatedAt'])
    expect(SKILL_SORT_FIELDS).toEqual(['name', 'category', 'createdAt'])
    expect(DOCUMENT_SORT_FIELDS).toEqual(['title', 'status', 'createdAt', 'updatedAt'])
  })
})
