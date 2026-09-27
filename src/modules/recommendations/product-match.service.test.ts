import { describe, expect, it } from 'vitest'
import type { CurrentUser } from '@/shared/auth/current-user'
import type { UserRole } from '@/shared/contracts/enums'
import { canDraftOfferLetter, forPortfolio, forProgram } from './product-match.service'

function user(role: UserRole, isReviewer = false): CurrentUser {
  return { id: 'u', email: 'u@example.invalid', fullName: 'Тест', role, universityId: null, isReviewer }
}

describe('рекомендации продуктов: права', () => {
  it('черновик письма — тем, кто пишет вузам; эксперту тоже: это только текст', () => {
    expect(canDraftOfferLetter(user('MANAGER'))).toBe(true)
    expect(canDraftOfferLetter(user('HEAD'))).toBe(true)
    expect(canDraftOfferLetter(user('MANAGER', true))).toBe(true)
    expect(canDraftOfferLetter(user('VIEWER'))).toBe(false)
    expect(canDraftOfferLetter(user('ANALYST'))).toBe(false)
    expect(canDraftOfferLetter(user('UNIVERSITY_REP'))).toBe(false)
  })

  it('представитель вуза рекомендаций не видит — 403 до обращения к базе', async () => {
    await expect(forProgram(user('UNIVERSITY_REP'), 'p1', { limit: 3 })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(forPortfolio(user('UNIVERSITY_REP'), { limit: 20 })).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })
})
