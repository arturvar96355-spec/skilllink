import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Prisma } from '@/generated/prisma/client'
import { DSAR_NOT_PERSONAL, DSAR_REGISTRY, type DsarEntry, type DsarSubjectKind } from './dsar.registry'
import { SECRET_KEY_PATTERN } from './dsar.rules'

/**
 * Тест полноты реестра «всё о субъекте» (решение 116).
 *
 * Класс ошибок, от которого он защищает: добавили таблицу со ссылкой на пользователя
 * или контакт (или с почтой, телефоном, ФИО) — и забыли её в выгрузке и в обезличивании.
 * Каскады ON DELETE при обезличивании не срабатывают, так что забытая таблица
 * тихо сохранит ПД. Тест читает схему Prisma и сверяет её с реестром.
 */

interface SchemaField {
  name: string
  type: string
  /** Для поля-связи: какие скалярные поля модели ссылаются на `type`. */
  relationFields: string[]
}

/** Модели схемы и их поля — разбором prisma/schema.prisma. */
function parseSchema(): Map<string, SchemaField[]> {
  const text = readFileSync(join(process.cwd(), 'prisma/schema.prisma'), 'utf8')
  const models = new Map<string, SchemaField[]>()
  for (const match of text.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
    const fields: SchemaField[] = []
    for (const rawLine of match[2]!.split('\n')) {
      const line = rawLine.trim()
      if (!line || line.startsWith('//') || line.startsWith('@@') || line.startsWith('/') || line.startsWith('*')) continue
      const parts = /^(\w+)\s+(\w+)(\[\])?\??/.exec(line)
      if (!parts) continue
      const relation = /@relation\([^)]*fields:\s*\[([^\]]+)\]/.exec(line)
      fields.push({
        name: parts[1]!,
        type: parts[2]!,
        relationFields: relation ? relation[1]!.split(',').map((field) => field.trim()) : [],
      })
    }
    models.set(match[1]!, fields)
  }
  return models
}

/** Поля, которые сами по себе — ПД человека (реальные имена полей схемы). */
const PERSONAL_FIELD_NAMES = new Set([
  'email',
  'phone',
  'fullName',
  'position',
  'externalName',
  'username',
  'chatId',
  'ip',
  'passwordHash',
  'tokenHash',
])

/** Модели, на которые ссылка означает «это про человека». */
const SUBJECT_MODELS: Record<string, DsarSubjectKind> = { User: 'USER', Contact: 'CONTACT' }

const schema = parseSchema()
const allEntries: Array<[DsarSubjectKind, DsarEntry]> = (Object.keys(DSAR_REGISTRY) as DsarSubjectKind[]).flatMap(
  (kind) => DSAR_REGISTRY[kind].map((entry) => [kind, entry] as [DsarSubjectKind, DsarEntry]),
)

function keysDeep(value: unknown): string[] {
  if (value === null || typeof value !== 'object') return []
  return Object.entries(value).flatMap(([key, nested]) => [key, ...keysDeep(nested)])
}

describe('разбор схемы', () => {
  it('нашёл ровно те модели, что знает клиент Prisma', () => {
    expect([...schema.keys()].sort()).toEqual(Object.values(Prisma.ModelName).sort())
  })
})

describe('реестр DSAR покрывает схему', () => {
  it('каждая ссылка на пользователя или контакт есть в реестре своего субъекта', () => {
    const missing: string[] = []
    for (const [model, fields] of schema) {
      for (const field of fields) {
        const kind = SUBJECT_MODELS[field.type]
        if (!kind || field.relationFields.length === 0) continue
        for (const link of field.relationFields) {
          const covered = DSAR_REGISTRY[kind].some((entry) => entry.model === model && entry.links.includes(link))
          if (!covered) missing.push(`${model}.${link} → ${field.type}`)
        }
      }
    }
    expect(
      missing,
      'добавь модель в реестр DSAR (src/modules/dsar/dsar.registry.ts) с этим полем в links ' +
        'или пометь раздел keep с причиной',
    ).toEqual([])
  })

  it('профиль субъекта — в реестре по своему id', () => {
    for (const [model, kind] of Object.entries(SUBJECT_MODELS)) {
      expect(
        DSAR_REGISTRY[kind as DsarSubjectKind].some((entry) => entry.model === model && entry.links.includes('id')),
        `профиль ${model} должен быть в реестре`,
      ).toBe(true)
    }
  })

  it('каждое поле с ПД либо выгружается, либо не выгружается с причиной', () => {
    const missing: string[] = []
    for (const [model, fields] of schema) {
      const entries = allEntries.filter(([, entry]) => entry.model === model).map(([, entry]) => entry)
      for (const field of fields) {
        if (!PERSONAL_FIELD_NAMES.has(field.name)) continue
        const covered = entries.some((entry) => field.name in entry.select || (entry.omitted && field.name in entry.omitted))
        if (!covered) missing.push(`${model}.${field.name}`)
      }
    }
    expect(
      missing,
      'добавь модель X в реестр DSAR или пометь keep с причиной; поле с ПД — в select или в omitted с причиной',
    ).toEqual([])
  })

  it('каждая модель схемы — в реестре или в списке «без ПД» с причиной', () => {
    const unknown = [...schema.keys()].filter(
      (model) => !allEntries.some(([, entry]) => entry.model === model) && !DSAR_NOT_PERSONAL[model as Prisma.ModelName],
    )
    expect(unknown, 'добавь модель в реестр DSAR или в DSAR_NOT_PERSONAL с причиной').toEqual([])
  })

  it('модель «без ПД» не ссылается на людей и не хранит ПД', () => {
    for (const model of Object.keys(DSAR_NOT_PERSONAL)) {
      const fields = schema.get(model) ?? []
      const personal = fields.filter(
        (field) => PERSONAL_FIELD_NAMES.has(field.name) || (SUBJECT_MODELS[field.type] && field.relationFields.length > 0),
      )
      expect(personal.map((field) => field.name), `${model} помечена «без ПД»`).toEqual([])
    }
  })
})

describe('записи реестра согласованы со схемой', () => {
  it.each(allEntries)('%s: раздел ссылается на существующие поля', (_kind, entry) => {
    const fields = schema.get(entry.model)
    expect(fields, `модели ${entry.model} нет в схеме`).toBeDefined()
    const names = new Set(fields!.map((field) => field.name))
    for (const link of entry.links) expect(names.has(link), `${entry.model}.${link}`).toBe(true)
    for (const key of Object.keys(entry.select)) expect(names.has(key), `${entry.model}.${key} в select`).toBe(true)
    for (const key of Object.keys(entry.omitted ?? {})) expect(names.has(key), `${entry.model}.${key} в omitted`).toBe(true)
    for (const key of Object.keys({ id: 'asc', ...entry.orderBy, ...entry.tieBreaker })) {
      if (key === 'id' && entry.tieBreaker) continue
      expect(names.has(key), `${entry.model}.${key} в orderBy`).toBe(true)
    }
  })

  it.each(allEntries)('%s: в выгрузку не выбираются секреты', (_kind, entry) => {
    expect(keysDeep(entry.select).filter((key) => SECRET_KEY_PATTERN.test(key))).toEqual([])
  })

  it.each(allEntries)('%s: у действия есть обоснование, у redact — набор полей', (_kind, entry) => {
    expect(entry.reason.length).toBeGreaterThan(10)
    if (entry.erase === 'redact') expect(entry.redact).toBeTypeOf('function')
  })

  it('разделы внутри субъекта не повторяются', () => {
    for (const kind of Object.keys(DSAR_REGISTRY) as DsarSubjectKind[]) {
      const sections = DSAR_REGISTRY[kind].map((entry) => entry.section)
      expect(new Set(sections).size, kind).toBe(sections.length)
    }
  })

  it('журнал: у каждого субъекта есть «действия над ним», у пользователя — и «его действия»', () => {
    expect(DSAR_REGISTRY.USER.filter((entry) => entry.trail).map((entry) => entry.trail).sort()).toEqual([
      'aboutSubject',
      'byActor',
    ])
    expect(DSAR_REGISTRY.CONTACT.filter((entry) => entry.trail).map((entry) => entry.trail)).toEqual(['aboutSubject'])
  })

  it('журнал действий обезличиванием не меняется', () => {
    for (const [, entry] of allEntries) {
      if (entry.model === 'AuditLog') expect(entry.erase).toBe('keep')
    }
  })

  it('обезличивание пользователя удаляет доступ без сессии и не удаляет рабочие записи', () => {
    const deleted = DSAR_REGISTRY.USER.filter((entry) => entry.erase === 'delete').map((entry) => entry.model).sort()
    expect(deleted).toEqual(['CalendarFeed', 'NotificationChannelLink', 'TelegramLink'])
    expect(DSAR_REGISTRY.CONTACT.filter((entry) => entry.erase === 'delete')).toEqual([])
  })
})
