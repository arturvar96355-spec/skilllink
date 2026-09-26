import { describe, expect, it } from 'vitest'
import { patchWorkflowStageTemplateSchema, workflowStageNumberSchema } from './workflow-templates.schema'

/**
 * Настройки → Workflow (ТЗ, функц. требования пп. 6, 9; решение 146).
 * `isControlPoint` намеренно нет в схеме тела — его проверяет отдельно route.ts
 * до разбора схемой (там же и объяснение решений 5/28), а не эта схема.
 */
describe('PATCH /api/settings/workflow/stages/:number — валидация', () => {
  it('принимает только название', () => {
    const parsed = patchWorkflowStageTemplateSchema.safeParse({ title: 'Новое название' })
    expect(parsed.success).toBe(true)
  })

  it('принимает только срок', () => {
    const parsed = patchWorkflowStageTemplateSchema.safeParse({ normativeDays: 10 })
    expect(parsed.success).toBe(true)
  })

  it('отклоняет пустое тело — нечего менять', () => {
    expect(patchWorkflowStageTemplateSchema.safeParse({}).success).toBe(false)
  })

  it('отклоняет пустое название', () => {
    expect(patchWorkflowStageTemplateSchema.safeParse({ title: '  ' }).success).toBe(false)
  })

  it('отклоняет срок не целым числом и вне границ', () => {
    expect(patchWorkflowStageTemplateSchema.safeParse({ normativeDays: 0 }).success).toBe(false)
    expect(patchWorkflowStageTemplateSchema.safeParse({ normativeDays: 1.5 }).success).toBe(false)
    expect(patchWorkflowStageTemplateSchema.safeParse({ normativeDays: 4000 }).success).toBe(false)
  })

  it('applyToUnfinishedStages необязателен и должен быть булевым', () => {
    expect(
      patchWorkflowStageTemplateSchema.safeParse({ normativeDays: 5, applyToUnfinishedStages: true }).success,
    ).toBe(true)
    expect(
      patchWorkflowStageTemplateSchema.safeParse({ normativeDays: 5, applyToUnfinishedStages: 'true' }).success,
    ).toBe(false)
  })

  it('лишние поля (не isControlPoint) молча отбрасываются схемой Zod', () => {
    // isControlPoint route.ts проверяет заранее и отклоняет с объяснением —
    // до того, как тело дойдёт до этой схемы.
    const parsed = patchWorkflowStageTemplateSchema.safeParse({ title: 'X', extra: 1 })
    expect(parsed.success).toBe(true)
  })
})

describe('номер этапа в пути — 1..14', () => {
  it('принимает границы', () => {
    expect(workflowStageNumberSchema.safeParse('1').success).toBe(true)
    expect(workflowStageNumberSchema.safeParse('14').success).toBe(true)
  })

  it('отклоняет вне границ и нечисловое', () => {
    expect(workflowStageNumberSchema.safeParse('0').success).toBe(false)
    expect(workflowStageNumberSchema.safeParse('15').success).toBe(false)
    expect(workflowStageNumberSchema.safeParse('abc').success).toBe(false)
  })
})
