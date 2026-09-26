import { describe, expect, it } from 'vitest'
import { AppError } from '@/shared/http/errors'
import { CONTROL_STAGE_NUMBER, WORKFLOW_STAGES } from '@/shared/config/workflow.config'
import {
  createCooperationSchema,
  updateCooperationSchema,
} from './cooperation.schema'
import {
  assertCooperationEditable,
  assertNoDuplicateCooperation,
  assertProgramBelongsToUniversity,
  buildStages,
} from './cooperation.rules'
import { buildWhere } from './cooperation.repo'

describe('набор этапов новой связки', () => {
  const startedAt = new Date('2026-01-01T00:00:00.000Z')
  const stages = buildStages(startedAt, 'user-1')

  it('создаёт ровно 14 этапов из ТЗ', () => {
    expect(stages).toHaveLength(14)
    expect(stages.map((stage) => stage.stageNumber)).toEqual(
      Array.from({ length: 14 }, (_, index) => index + 1),
    )
  })

  it('переносит названия этапов из конфига', () => {
    expect(stages[0]?.title).toBe(WORKFLOW_STAGES[0]?.title)
    expect(stages[13]?.stageNumber).toBe(CONTROL_STAGE_NUMBER)
  })

  it('расставляет сроки по нарастающей', () => {
    const deadlines = stages.map((stage) => stage.deadline.getTime())
    const sorted = [...deadlines].sort((a, b) => a - b)
    expect(deadlines).toEqual(sorted)
    expect(deadlines[0]).toBeGreaterThan(startedAt.getTime())
  })

  it('переносит признак пункта вуза из конфига (решение 103)', () => {
    const flagged = stages.flatMap((stage) =>
      stage.tasks.filter((task) => task.isUniversityItem).map((task) => [stage.stageNumber, task.title]),
    )
    expect(flagged).toEqual([[7, 'Вуз подтвердил получение материалов']])
  })

  it('не создаёт чек-лист у контрольного этапа', () => {
    expect(stages.find((stage) => stage.stageNumber === CONTROL_STAGE_NUMBER)?.tasks).toHaveLength(0)
  })

  it('заполняет чек-листы остальных этапов', () => {
    const withoutControl = stages.filter((stage) => stage.stageNumber !== CONTROL_STAGE_NUMBER)
    expect(withoutControl.every((stage) => stage.tasks.length > 0)).toBe(true)
  })
})

describe('правила связки', () => {
  it('не даёт связать программу чужого вуза', () => {
    expect(() => assertProgramBelongsToUniversity('uni-a', 'uni-b')).toThrowError(AppError)
    expect(() => assertProgramBelongsToUniversity('uni-a', 'uni-a')).not.toThrow()
  })

  it('не даёт править закрытую связку', () => {
    expect(() => assertCooperationEditable('COMPLETED', undefined)).toThrowError(AppError)
    expect(() => assertCooperationEditable('CANCELLED', undefined)).toThrowError(AppError)
    expect(() => assertCooperationEditable('ACTIVE', undefined)).not.toThrow()
  })

  it('не даёт обойти запрет, передав закрытой связке её же статус', () => {
    // Раньше проверка срабатывала только при отсутствии статуса в теле,
    // и `{ status: "COMPLETED", goal: "…" }` правил закрытую связку.
    expect(() => assertCooperationEditable('COMPLETED', 'COMPLETED')).toThrowError(AppError)
    expect(() => assertCooperationEditable('COMPLETED', 'CANCELLED')).toThrowError(AppError)
  })

  it('разрешает переоткрыть закрытую связку', () => {
    expect(() => assertCooperationEditable('COMPLETED', 'ACTIVE')).not.toThrow()
    expect(() => assertCooperationEditable('CANCELLED', 'DRAFT')).not.toThrow()
  })

  it('действующую связку правит как угодно', () => {
    expect(() => assertCooperationEditable('ACTIVE', 'PAUSED')).not.toThrow()
    expect(() => assertCooperationEditable('DRAFT', 'COMPLETED')).not.toThrow()
  })
})

describe('валидация связки', () => {
  const valid = {
    universityId: 'uni-1',
    programId: 'prog-1',
    responsibleId: 'user-1',
  }

  it('создаёт связку без продукта', () => {
    const parsed = createCooperationSchema.safeParse(valid)
    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data.status).toBe('DRAFT')
  })

  it('требует ответственного', () => {
    const parsed = createCooperationSchema.safeParse({ ...valid, responsibleId: '' })
    expect(parsed.success).toBe(false)
  })

  it('отклоняет дату не в формате ISO 8601', () => {
    expect(
      createCooperationSchema.safeParse({ ...valid, targetDate: '01.09.2026' }).success,
    ).toBe(false)
  })

  // Проверка бага: `.partial()` не снимает `.default()`, пустой PATCH не должен менять статус.
  it('не принимает пустое тело изменения', () => {
    expect(updateCooperationSchema.safeParse({}).success).toBe(false)
  })

  it('не подставляет статус по умолчанию при изменении', () => {
    const parsed = updateCooperationSchema.safeParse({ goal: 'Новая цель' })
    expect(parsed.success).toBe(true)
    expect(parsed.success && 'status' in parsed.data).toBe(false)
  })
})

describe('каталог по ТЗ (решение 145): поля связки, PATCH их принимает', () => {
  it('принимает все поля каталога сразу', () => {
    const parsed = updateCooperationSchema.safeParse({
      contractNumber: '77/2025-ИБ',
      licenseSignedAt: '2026-05-04T00:00:00.000Z',
      licenseTermYears: 3,
      transferStatus: 'TRANSFERRED',
      comment: 'Лицензия передана вузу.',
    })
    expect(parsed.success).toBe(true)
  })

  it('срок действия лицензии — 1..10 лет', () => {
    expect(updateCooperationSchema.safeParse({ licenseTermYears: 0 }).success).toBe(false)
    expect(updateCooperationSchema.safeParse({ licenseTermYears: 11 }).success).toBe(false)
    expect(updateCooperationSchema.safeParse({ licenseTermYears: 1 }).success).toBe(true)
    expect(updateCooperationSchema.safeParse({ licenseTermYears: 10 }).success).toBe(true)
  })

  it('статус передачи — только из перечня ТЗ', () => {
    expect(updateCooperationSchema.safeParse({ transferStatus: 'SOMETHING_ELSE' }).success).toBe(false)
    for (const status of ['NOT_TRANSFERRED', 'IN_PROGRESS', 'TRANSFERRED', 'REVOKED']) {
      expect(updateCooperationSchema.safeParse({ transferStatus: status }).success).toBe(true)
    }
  })

  it('поля каталога необязательны — PATCH только с одним из них проходит', () => {
    expect(updateCooperationSchema.safeParse({ comment: 'Заметка' }).success).toBe(true)
  })

  it('снятие значения явным null проходит (например, снять номер договора)', () => {
    const parsed = updateCooperationSchema.safeParse({ contractNumber: null })
    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data.contractNumber).toBeNull()
  })
})

describe('поиск связок', () => {
  const now = new Date('2026-09-25T00:00:00.000Z')
  const where = (q: string) =>
    buildWhere({ q, page: 1, pageSize: 20 }, {}, now) as { AND: Array<{ OR: object[] }> }

  it('ищет по краткому имени вуза и по ответственному', () => {
    const fields = where('СПбГУТ').AND[0]?.OR ?? []
    expect(fields).toContainEqual({
      university: { shortName: { contains: 'СПбГУТ', mode: 'insensitive' } },
    })
    expect(fields).toContainEqual({
      responsible: { fullName: { contains: 'СПбГУТ', mode: 'insensitive' } },
    })
    expect(fields).toContainEqual({
      program: { name: { contains: 'СПбГУТ', mode: 'insensitive' } },
    })
    expect(fields).toContainEqual({
      product: { name: { contains: 'СПбГУТ', mode: 'insensitive' } },
    })
  })

  it('каждое слово запроса — отдельное условие: «спбгут программная» ищет оба', () => {
    const conditions = where('спбгут программная').AND
    expect(conditions).toHaveLength(2)
    expect(conditions[1]?.OR).toContainEqual({
      program: { name: { contains: 'программная', mode: 'insensitive' } },
    })
  })

  it('поиск не отменяет остальные фильтры', () => {
    const result = buildWhere(
      { q: 'Савельева', status: ['ACTIVE'], onlyBlocked: true, page: 1, pageSize: 20 },
      {},
      now,
    )
    expect(result?.status).toEqual({ in: ['ACTIVE'] })
    expect(result?.stages).toEqual({ some: { status: 'BLOCKED' } })
    expect(result?.AND).toHaveLength(1)
  })
})

describe('одна незакрытая связка на «вуз + программа + продукт»', () => {
  it('без дубля — проходит', () => {
    expect(() => assertNoDuplicateCooperation(null)).not.toThrow()
  })

  it('дубль — 409 с названием, статусом и ссылкой на существующую связку', () => {
    try {
      assertNoDuplicateCooperation({
        id: 'coop-1',
        status: 'ACTIVE',
        universityName: 'СПбГУТ',
        programName: 'Информационная безопасность',
      })
    } catch (error) {
      expect(error).toBeInstanceOf(AppError)
      const appError = error as AppError
      expect(appError.code).toBe('CONFLICT')
      expect(appError.status).toBe(409)
      expect(appError.message).toBe(
        'Такая связка уже есть: СПбГУТ — Информационная безопасность, статус «В работе»',
      )
      expect(appError.details).toEqual({ cooperationId: 'coop-1' })
      return
    }
    throw new Error('Ожидался отказ CONFLICT')
  })
})
