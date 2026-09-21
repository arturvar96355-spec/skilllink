import { describe, expect, it } from 'vitest'
import { AppError } from '@/shared/http/errors'
import { CONTROL_STAGE_NUMBER, WORKFLOW_STAGES } from '@/shared/config/workflow.config'
import {
  createCooperationSchema,
  updateCooperationSchema,
} from './cooperation.schema'
import {
  assertCooperationEditable,
  assertProgramBelongsToUniversity,
  buildStages,
} from './cooperation.rules'

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
    expect(() => assertCooperationEditable('COMPLETED')).toThrowError(AppError)
    expect(() => assertCooperationEditable('CANCELLED')).toThrowError(AppError)
    expect(() => assertCooperationEditable('ACTIVE')).not.toThrow()
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
