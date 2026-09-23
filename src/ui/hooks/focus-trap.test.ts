import { describe, expect, it } from 'vitest'
import { nextFocusIndex } from './focus-trap'

describe('фокус ходит по кругу внутри окна', () => {
  it('с последнего поля Tab ведёт на первое, с первого Shift+Tab — на последнее', () => {
    expect(nextFocusIndex(4, 3, false)).toBe(0)
    expect(nextFocusIndex(4, 0, true)).toBe(3)
  })

  it('фокус снаружи окна возвращается внутрь', () => {
    expect(nextFocusIndex(4, -1, false)).toBe(0)
    expect(nextFocusIndex(4, -1, true)).toBe(3)
  })

  it('в окне без полей переходить некуда', () => {
    expect(nextFocusIndex(0, -1, false)).toBe(-1)
  })
})
