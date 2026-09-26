import { describe, expect, it } from 'vitest'
import { UNIVERSITY_MERGE } from '@/shared/config/data-quality.config'
import {
  assertCanMerge,
  assertCanUndo,
  countMoved,
  fieldsTakenFromSource,
  isEmptyValue,
  planSurvivorship,
  planUndoFields,
  undoDeadline,
  type MovedIds,
  type UniversityFields,
} from './merge.rules'

/**
 * Слияние вузов (решение 134): чьё значение поля остаётся (survivorship), проверки
 * до слияния и до отмены, что возвращается при отмене. Перенос объектов и сама
 * транзакция — merge.repo.test.ts; здесь — чистые функции без базы.
 */

const FIELDS: UniversityFields = {
  name: 'Университет А',
  shortName: null,
  city: 'Москва',
  region: 'Москва',
  address: null,
  website: null,
  description: null,
  directionCount: null,
  studentCount: null,
  inn: null,
  ogrn: null,
}

const side = (fields: Partial<UniversityFields>, updatedAt: string) => ({
  fields: { ...FIELDS, ...fields },
  updatedAt: new Date(updatedAt),
})

describe('isEmptyValue', () => {
  it('null, undefined и пробелы — пусто; 0 и непустая строка — нет', () => {
    expect(isEmptyValue(null)).toBe(true)
    expect(isEmptyValue(undefined)).toBe(true)
    expect(isEmptyValue('   ')).toBe(true)
    expect(isEmptyValue('')).toBe(true)
    expect(isEmptyValue(0)).toBe(false)
    expect(isEmptyValue('Москва')).toBe(false)
  })
})

describe('planSurvivorship: non_null', () => {
  it('пустое значение цели не побеждает — берётся источник', () => {
    const target = side({ website: null }, '2026-01-01')
    const source = side({ website: 'https://source.ru' }, '2026-01-01')
    const plan = planSurvivorship(target, source, { website: 'non_null' })
    const entry = plan.entries.find((item) => item.field === 'website')!
    expect(entry).toMatchObject({ chosen: 'source', changed: true, resultValue: 'https://source.ru' })
    expect(plan.targetUpdate.website).toBe('https://source.ru')
  })

  it('оба пустых — остаётся пусто, поле не входит в изменения', () => {
    const target = side({ website: null }, '2026-01-01')
    const source = side({ website: null }, '2026-01-01')
    const plan = planSurvivorship(target, source, { website: 'non_null' })
    const entry = plan.entries.find((item) => item.field === 'website')!
    expect(entry).toMatchObject({ chosen: 'target', changed: false })
    expect(plan.targetUpdate.website).toBeUndefined()
  })

  it('оба непустых — остаётся значение цели, правило по умолчанию', () => {
    const target = side({ city: 'Казань' }, '2026-01-01')
    const source = side({ city: 'Иннополис' }, '2026-01-01')
    const plan = planSurvivorship(target, source)
    const entry = plan.entries.find((item) => item.field === 'city')!
    expect(entry).toMatchObject({ chosen: 'target', changed: false, rule: 'non_null' })
  })
})

describe('planSurvivorship: most_recent', () => {
  it('источник обновлялся позже — берётся его значение', () => {
    const target = side({ description: 'Старое' }, '2026-01-01')
    const source = side({ description: 'Новое' }, '2026-06-01')
    const plan = planSurvivorship(target, source, { description: 'most_recent' })
    expect(plan.entries.find((e) => e.field === 'description')).toMatchObject({ chosen: 'source', resultValue: 'Новое' })
  })

  it('при равенстве времени побеждает цель', () => {
    const target = side({ description: 'Цель' }, '2026-01-01')
    const source = side({ description: 'Источник' }, '2026-01-01')
    const plan = planSurvivorship(target, source, { description: 'most_recent' })
    expect(plan.entries.find((e) => e.field === 'description')).toMatchObject({ chosen: 'target' })
  })

  it('источник новее, но его значение пусто — берётся значение цели', () => {
    const target = side({ description: 'Цель' }, '2026-01-01')
    const source = side({ description: null }, '2026-06-01')
    const plan = planSurvivorship(target, source, { description: 'most_recent' })
    expect(plan.entries.find((e) => e.field === 'description')).toMatchObject({ chosen: 'target', resultValue: 'Цель' })
  })

  it('цель новее, но её значение пусто — берётся значение источника', () => {
    const target = side({ description: null }, '2026-06-01')
    const source = side({ description: 'Источник' }, '2026-01-01')
    const plan = planSurvivorship(target, source, { description: 'most_recent' })
    expect(plan.entries.find((e) => e.field === 'description')).toMatchObject({ chosen: 'source', resultValue: 'Источник' })
  })
})

describe('planSurvivorship: longest', () => {
  it('строка длиннее без учёта краевых пробелов', () => {
    const target = side({ description: 'коротко' }, '2026-01-01')
    const source = side({ description: '  значительно длиннее описание  ' }, '2026-01-01')
    const plan = planSurvivorship(target, source, { description: 'longest' })
    expect(plan.entries.find((e) => e.field === 'description')).toMatchObject({ chosen: 'source' })
  })

  it('числа — больше значение побеждает', () => {
    const target = side({ studentCount: 100 }, '2026-01-01')
    const source = side({ studentCount: 5000 }, '2026-01-01')
    const plan = planSurvivorship(target, source, { studentCount: 'longest' })
    expect(plan.entries.find((e) => e.field === 'studentCount')).toMatchObject({ chosen: 'source', resultValue: 5000 })
  })

  it('источник пуст — цель побеждает даже если её строка короче', () => {
    const target = side({ description: 'x' }, '2026-01-01')
    const source = side({ description: null }, '2026-01-01')
    const plan = planSurvivorship(target, source, { description: 'longest' })
    expect(plan.entries.find((e) => e.field === 'description')).toMatchObject({ chosen: 'target' })
  })
})

describe('planSurvivorship: manual', () => {
  it('берётся значение, заданное администратором, а не цели и не источника', () => {
    const target = side({ city: 'Казань' }, '2026-01-01')
    const source = side({ city: 'Иннополис' }, '2026-01-01')
    const plan = planSurvivorship(target, source, { city: 'manual' }, { city: 'Верхнеуслонский район' })
    expect(plan.entries.find((e) => e.field === 'city')).toMatchObject({
      chosen: 'manual',
      resultValue: 'Верхнеуслонский район',
      changed: true,
    })
  })
})

describe('planSurvivorship: поля без явного правила', () => {
  it('не заданное правило — non_null по умолчанию для всех полей сразу', () => {
    const target = side({ website: null, address: 'Ленина, 1' }, '2026-01-01')
    const source = side({ website: 'https://a.ru', address: 'Мира, 2' }, '2026-01-01')
    const plan = planSurvivorship(target, source)
    expect(plan.targetUpdate).toEqual({ website: 'https://a.ru' })
  })
})

describe('assertCanMerge', () => {
  const ok = { id: 't', mergedIntoId: null, archivedAt: null, inn: null }

  it('источник уже слит с кем-то — конфликт', () => {
    expect(() => assertCanMerge({ id: 's', mergedIntoId: 'other', inn: null }, ok)).toThrow()
  })

  it('цель в архиве или сама уже слита — ошибка валидации', () => {
    expect(() => assertCanMerge({ id: 's', mergedIntoId: null, inn: null }, { ...ok, archivedAt: new Date() })).toThrow()
    expect(() => assertCanMerge({ id: 's', mergedIntoId: null, inn: null }, { ...ok, mergedIntoId: 'x' })).toThrow()
  })

  it('разные ИНН — не дубли, слияние запрещено', () => {
    expect(() =>
      assertCanMerge({ id: 's', mergedIntoId: null, inn: '7700000000' }, { ...ok, inn: '7800000000' }),
    ).toThrow()
  })

  it('одинаковый ИНН или ИНН есть только у одного — можно', () => {
    expect(() => assertCanMerge({ id: 's', mergedIntoId: null, inn: '7700000000' }, { ...ok, inn: '7700000000' })).not.toThrow()
    expect(() => assertCanMerge({ id: 's', mergedIntoId: null, inn: null }, { ...ok, inn: '7700000000' })).not.toThrow()
  })
})

describe('undoDeadline / assertCanUndo', () => {
  it('срок отмены — UNIVERSITY_MERGE.undoDays дней от момента слияния', () => {
    const mergedAt = new Date('2026-01-01T00:00:00Z')
    const deadline = undoDeadline(mergedAt)
    expect(deadline.getTime() - mergedAt.getTime()).toBe(UNIVERSITY_MERGE.undoDays * 24 * 60 * 60 * 1000)
  })

  it('уже отменённое слияние отменить нельзя', () => {
    expect(() =>
      assertCanUndo({ undoneAt: new Date(), undoUntil: new Date('2099-01-01') }, new Date()),
    ).toThrow()
  })

  it('после дедлайна — нельзя, до — можно', () => {
    const merge = { undoneAt: null, undoUntil: new Date('2026-06-01T00:00:00Z') }
    expect(() => assertCanUndo(merge, new Date('2026-07-01'))).toThrow()
    expect(() => assertCanUndo(merge, new Date('2026-05-01'))).not.toThrow()
  })
})

describe('planUndoFields', () => {
  it('поле не менялось с тех пор — возвращается к значению до слияния', () => {
    const entries = [
      { field: 'website' as const, rule: 'non_null' as const, chosen: 'source' as const, changed: true, targetValue: null, sourceValue: 'https://a.ru', resultValue: 'https://a.ru' },
    ]
    const plan = planUndoFields(entries, { ...FIELDS, website: 'https://a.ru' })
    expect(plan.restored).toEqual(['website'])
    expect(plan.restore.website).toBeNull()
  })

  it('поле изменили после слияния — значение не трогаем', () => {
    const entries = [
      { field: 'website' as const, rule: 'non_null' as const, chosen: 'source' as const, changed: true, targetValue: null, sourceValue: 'https://a.ru', resultValue: 'https://a.ru' },
    ]
    const plan = planUndoFields(entries, { ...FIELDS, website: 'https://changed-later.ru' })
    expect(plan.kept).toEqual(['website'])
    expect(plan.restore.website).toBeUndefined()
  })

  it('поле не менялось при слиянии — отмена его не касается', () => {
    const entries = [
      { field: 'city' as const, rule: 'non_null' as const, chosen: 'target' as const, changed: false, targetValue: 'Москва', sourceValue: 'Москва', resultValue: 'Москва' },
    ]
    const plan = planUndoFields(entries, FIELDS)
    expect(plan.restored).toEqual([])
    expect(plan.kept).toEqual([])
  })
})

describe('countMoved / fieldsTakenFromSource', () => {
  it('считает перенесённые объекты по таблицам', () => {
    const moved: MovedIds = {
      programs: ['p1', 'p2'],
      contacts: ['c1'],
      cooperations: [],
      meetings: ['m1', 'm2', 'm3'],
      documents: [],
      applications: ['a1'],
      users: [],
      demotedContacts: ['c1'],
    }
    expect(countMoved(moved)).toEqual({
      programs: 2,
      contacts: 1,
      cooperations: 0,
      meetings: 3,
      documents: 0,
      applications: 1,
      users: 0,
    })
  })

  it('в журнал действий попадают только имена изменившихся полей', () => {
    const entries = [
      { field: 'website' as const, rule: 'non_null' as const, chosen: 'source' as const, changed: true, targetValue: null, sourceValue: 'a', resultValue: 'a' },
      { field: 'city' as const, rule: 'non_null' as const, chosen: 'target' as const, changed: false, targetValue: 'Москва', sourceValue: 'Москва', resultValue: 'Москва' },
    ]
    expect(fieldsTakenFromSource(entries)).toEqual(['website'])
  })
})
