import { describe, expect, it } from 'vitest'
import { reviewLetterSchema } from '@/modules/inbound-letters/inbound-letters.schema'
import { incorrectReviewProblems, missingFieldsText } from './review-form'

const filled = { universityId: 'u1', group: 'QUESTION', action: 'Ответить вузу', comment: 'Это вопрос, а не встреча' }

describe('форма «Неверно» (решение 210, S9)', () => {
  it('заполнено всё — отправлять можно', () => {
    expect(incorrectReviewProblems(filled)).toEqual({})
    expect(missingFieldsText({})).toBeNull()
  })

  it('сменили группу, а комментарий пуст — форма называет поле, а не молчит', () => {
    const problems = incorrectReviewProblems({ ...filled, comment: '   ' })
    expect(Object.keys(problems)).toEqual(['comment'])
    expect(missingFieldsText(problems)).toBe('Заполните: что было не так')
  })

  it('тексты подсказок — те же, что у сервера', () => {
    const problems = incorrectReviewProblems({ universityId: '', group: '', action: '', comment: '' })
    const server = reviewLetterSchema.safeParse({ verdict: 'INCORRECT' })
    expect(server.success).toBe(false)
    const serverMessages = new Set(server.error!.issues.map((issue) => issue.message))
    for (const message of Object.values(problems)) expect(serverMessages.has(message!)).toBe(true)
  })
})
