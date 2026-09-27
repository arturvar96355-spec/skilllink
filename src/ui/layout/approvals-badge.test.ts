import { describe, expect, it } from 'vitest'
import { approvalsCount, countBadgeText } from './approvals-badge'

describe('число у «Согласований» (решение 218)', () => {
  it('ждут моего решения плюс мои к выполнению; ноль и пустой ответ — без числа', () => {
    expect(approvalsCount({ awaiting: 2, readyToRun: 1 })).toBe(3)
    expect(approvalsCount({ awaiting: 0, readyToRun: 0 })).toBeUndefined()
    expect(approvalsCount(null)).toBeUndefined()
  })

  it('больше 99 — «99+», как у колокольчика', () => {
    expect(countBadgeText(7)).toBe('7')
    expect(countBadgeText(120)).toBe('99+')
  })
})
