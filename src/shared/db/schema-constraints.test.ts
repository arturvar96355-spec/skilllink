import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Ограничения, которые нельзя выразить в схеме Prisma, живут только в SQL
 * миграции. Такое легко потерять при следующей правке схемы: Prisma про них
 * не знает и не напомнит.
 *
 * Здесь проверяется, что они не исчезли из миграций и что схема о них
 * упоминает — чтобы следующий читатель искал их там, где они есть.
 */
describe('ограничения из разбора схемы Тиграном', () => {
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
    // не записывался вовсе.
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

  it('миграция подставляет регион до NOT NULL', () => {
    // Иначе она упадёт на любой базе, где есть замеры без региона.
    const index = migrations.indexOf('SET NOT NULL')
    const backfill = migrations.indexOf("SET \"region\" = 'Россия' WHERE \"region\" IS NULL")
    expect(backfill).toBeGreaterThan(-1)
    expect(backfill).toBeLessThan(index)
  })
})
