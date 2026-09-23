import { describe, expect, it } from 'vitest'
import { lastPage } from './page-range'

describe('последняя страница выдачи', () => {
  it('считается по числу строк', () => {
    expect(lastPage(41, 20)).toBe(3)
    expect(lastPage(40, 20)).toBe(2)
  })

  it('пустая выдача — первая страница, а не нулевая', () => {
    expect(lastPage(0, 20)).toBe(1)
  })
})
