import { describe, expect, it } from 'vitest'
import { mockMarks } from './origin'

const demo = { isMock: true }
const real = { isMock: false }

describe('mockMarks', () => {
  it('всё демо — пометка у раздела, строки чистые', () => {
    const marks = mockMarks([demo, demo])
    expect(marks.section).toBe(true)
    expect(marks.row(demo)).toBe(false)
  })

  it('смешанная выдача — помечены раздел и демо-строки', () => {
    const marks = mockMarks([demo, real])
    expect(marks.section).toBe(true)
    expect(marks.row(demo)).toBe(true)
    expect(marks.row(real)).toBe(false)
  })

  it('демо нет — пометок нет', () => {
    const marks = mockMarks([real])
    expect(marks.section).toBe(false)
    expect(marks.row(real)).toBe(false)
  })

  it('пустой список — пометок нет', () => {
    expect(mockMarks([]).section).toBe(false)
  })
})
