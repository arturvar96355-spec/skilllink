import { describe, expect, it } from 'vitest'
import { AppError } from '@/shared/http/errors'
import {
  BULK_TARGET_STATUSES,
  MATERIALS_UPDATE_STAGE_NUMBER,
  assertVersionChanged,
  assertVersionFormat,
  releaseTaskTitle,
  reopenComment,
} from './products.rules'
import {
  productListQuerySchema,
  releaseProductVersionSchema,
} from './products.schema'

function expectError(fn: () => void, code: string): void {
  try {
    fn()
  } catch (error) {
    expect(error).toBeInstanceOf(AppError)
    expect((error as AppError).code).toBe(code)
    return
  }
  throw new Error(`Ожидалась ошибка ${code}, но её не было`)
}

describe('групповая операция по продукту', () => {
  it('затрагивает этап обновления материалов', () => {
    expect(MATERIALS_UPDATE_STAGE_NUMBER).toBe(12)
  })

  it('не трогает закрытые и отменённые связки', () => {
    expect([...BULK_TARGET_STATUSES]).toEqual(['DRAFT', 'ACTIVE', 'PAUSED'])
    expect([...BULK_TARGET_STATUSES]).not.toContain('COMPLETED')
    expect([...BULK_TARGET_STATUSES]).not.toContain('CANCELLED')
  })

  it('повторный выпуск той же версии отклоняется', () => {
    expectError(() => assertVersionChanged('3.2', '3.2'), 'CONFLICT')
    expect(() => assertVersionChanged('3.2', '3.3')).not.toThrow()
  })

  it('продукт без версии можно выпустить впервые', () => {
    expect(() => assertVersionChanged(null, '1.0')).not.toThrow()
  })

  it('пустая версия отклоняется', () => {
    expectError(() => assertVersionFormat('   '), 'VALIDATION_ERROR')
    expect(() => assertVersionFormat('4.1')).not.toThrow()
  })

  it('задача называет продукт и версию', () => {
    const title = releaseTaskTitle('Облачная платформа РТК', '3.3')
    expect(title).toContain('Облачная платформа РТК')
    expect(title).toContain('3.3')
  })

  it('комментарий переоткрытия объясняет причину', () => {
    const comment = reopenComment('Облачная платформа РТК', '3.3')
    expect(comment).toContain('устарели')
    expect(comment).toContain('3.3')
  })
})

describe('валидация выпуска версии', () => {
  it('требует версию', () => {
    expect(releaseProductVersionSchema.safeParse({}).success).toBe(false)
    expect(releaseProductVersionSchema.safeParse({ version: '' }).success).toBe(false)
  })

  it('принимает версию с комментарием', () => {
    expect(
      releaseProductVersionSchema.safeParse({ version: '4.0', comment: 'Плановое обновление' })
        .success,
    ).toBe(true)
  })
})

describe('параметры списка продуктов', () => {
  it('приводит одиночный статус к массиву', () => {
    expect(productListQuerySchema.parse({ status: 'ACTIVE' }).status).toEqual(['ACTIVE'])
  })

  it('отклоняет неизвестный статус', () => {
    expect(productListQuerySchema.safeParse({ status: 'RETIRED' }).success).toBe(false)
  })
})
