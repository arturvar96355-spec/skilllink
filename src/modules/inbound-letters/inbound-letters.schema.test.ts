import { describe, expect, it } from 'vitest'
import { inboundLetterListQuerySchema, reviewLetterSchema, updateReplyDraftSchema } from './inbound-letters.schema'

describe('reviewLetterSchema', () => {
  it('«Верно» без дополнительных полей — валидно', () => {
    expect(reviewLetterSchema.safeParse({ verdict: 'CORRECT' }).success).toBe(true)
  })

  it('«Неверно» без вуза — невалидно', () => {
    const result = reviewLetterSchema.safeParse({ verdict: 'INCORRECT', group: 'MEETING', action: 'x', comment: 'почему' })
    expect(result.success).toBe(false)
  })

  it('«Неверно» без группы — невалидно', () => {
    const result = reviewLetterSchema.safeParse({ verdict: 'INCORRECT', universityId: 'u1', action: 'x', comment: 'почему' })
    expect(result.success).toBe(false)
  })

  it('«Неверно» без действия — невалидно', () => {
    const result = reviewLetterSchema.safeParse({ verdict: 'INCORRECT', universityId: 'u1', group: 'MEETING', comment: 'почему' })
    expect(result.success).toBe(false)
  })

  it('«Неверно» без комментария — невалидно (нужно основание)', () => {
    const result = reviewLetterSchema.safeParse({ verdict: 'INCORRECT', universityId: 'u1', group: 'MEETING', action: 'x' })
    expect(result.success).toBe(false)
  })

  it('«Неверно» со всеми полями — валидно, cooperationId необязателен', () => {
    const result = reviewLetterSchema.safeParse({
      verdict: 'INCORRECT',
      universityId: 'u1',
      group: 'MEETING',
      action: 'Согласовать время',
      comment: 'Вуз определён неверно',
    })
    expect(result.success).toBe(true)
  })

  it('неизвестный verdict — невалидно', () => {
    expect(reviewLetterSchema.safeParse({ verdict: 'maybe' }).success).toBe(false)
  })
})

describe('updateReplyDraftSchema', () => {
  it('пустой текст — невалидно', () => {
    expect(updateReplyDraftSchema.safeParse({ text: '' }).success).toBe(false)
  })

  it('текст в пределах лимита — валидно', () => {
    expect(updateReplyDraftSchema.safeParse({ text: 'Уважаемые коллеги!' }).success).toBe(true)
  })

  it('слишком длинный текст — невалидно', () => {
    expect(updateReplyDraftSchema.safeParse({ text: 'а'.repeat(4001) }).success).toBe(false)
  })
})

describe('inboundLetterListQuerySchema', () => {
  it('фильтр статуса принимает одно и несколько значений', () => {
    expect(inboundLetterListQuerySchema.parse({ status: 'NEW' }).status).toEqual(['NEW'])
    expect(inboundLetterListQuerySchema.parse({ status: ['NEW', 'ANALYZED'] }).status).toEqual(['NEW', 'ANALYZED'])
  })

  it('без параметров — только пагинация по умолчанию', () => {
    const parsed = inboundLetterListQuerySchema.parse({})
    expect(parsed.page).toBe(1)
    expect(parsed.status).toBeUndefined()
  })

  it('неизвестный статус отклоняется', () => {
    expect(inboundLetterListQuerySchema.safeParse({ status: 'DELETED' }).success).toBe(false)
  })
})
