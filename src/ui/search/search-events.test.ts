import { describe, expect, it } from 'vitest'
import { nextSearchAction } from './search-events'

describe('щелчок по кнопке поиска в шапке (решение 184)', () => {
  it('окно закрыто — щелчок открывает', () => {
    expect(nextSearchAction(false)).toBe('open')
  })

  it('окно уже открыто — повторный щелчок по той же кнопке закрывает', () => {
    expect(nextSearchAction(true)).toBe('close')
  })
})
