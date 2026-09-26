import { describe, expect, it } from 'vitest'
import { externalImportSchema } from './external.schema'

/** Пример из ТЗ (функц. требования п.5): вуз, ИТ-направление, ИТ-продукт, ответственные, externalId. */
const VALID_BODY = {
  source: 'site',
  externalId: 'ext-42',
  university: { name: 'Пробный университет' },
  program: { name: 'Информатика и вычислительная техника', code: '09.03.01' },
  product: { name: 'Курс по DevOps' },
  responsibleEmails: ['manager@example.com'],
}

describe('контракт приёма данных извне (решение 145, ТЗ функц. п.5)', () => {
  it('пример из задания проходит валидацию', () => {
    const result = externalImportSchema.safeParse(VALID_BODY)
    expect(result.success).toBe(true)
  })

  it('без source/externalId — понятная ошибка по каждому полю', () => {
    const result = externalImportSchema.safeParse({ ...VALID_BODY, source: undefined, externalId: undefined })
    expect(result.success).toBe(false)
    const fields = result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'))
    expect(fields).toContain('source')
    expect(fields).toContain('externalId')
  })

  it('source — только site или lms', () => {
    expect(externalImportSchema.safeParse({ ...VALID_BODY, source: 'crm' }).success).toBe(false)
  })

  it('ИНН вуза с неверной контрольной цифрой отклоняется', () => {
    const result = externalImportSchema.safeParse({
      ...VALID_BODY,
      university: { ...VALID_BODY.university, inn: '1234567890' },
    })
    expect(result.success).toBe(false)
  })

  it('пустой список почт ответственных отклоняется', () => {
    expect(externalImportSchema.safeParse({ ...VALID_BODY, responsibleEmails: [] }).success).toBe(false)
  })

  it('некорректная почта отклоняется', () => {
    expect(
      externalImportSchema.safeParse({ ...VALID_BODY, responsibleEmails: ['не почта'] }).success,
    ).toBe(false)
  })

  it('почта приводится к нижнему регистру', () => {
    const result = externalImportSchema.safeParse({ ...VALID_BODY, responsibleEmails: ['Manager@Example.com'] })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.responsibleEmails).toEqual(['manager@example.com'])
  })

  it('city/region вуза — необязательны сверх примерного контракта, но принимаются', () => {
    const result = externalImportSchema.safeParse({
      ...VALID_BODY,
      university: { ...VALID_BODY.university, city: 'Тверь', region: 'Тверская область' },
    })
    expect(result.success).toBe(true)
  })
})
