import { describe, expect, it } from 'vitest'
import { isDragGesture, wrapTrackOffset } from './ticker-track'

describe('заворот смещения бегущей строки', () => {
  it('внутри диапазона — не меняется', () => {
    expect(wrapTrackOffset(-50, 200)).toBe(-50)
    expect(wrapTrackOffset(0, 200)).toBe(0)
  })

  it('автопрокрутка уехала за одну ширину — заворачивает к началу', () => {
    expect(wrapTrackOffset(-250, 200)).toBe(-50)
    expect(wrapTrackOffset(-400, 200)).toBe(0)
  })

  it('перетащили за правый край — заворачивает к концу ленты', () => {
    expect(wrapTrackOffset(30, 200)).toBe(-170)
    expect(wrapTrackOffset(200, 200)).toBe(0)
  })

  it('ширина ленты ещё не измерена — смещения нет', () => {
    expect(wrapTrackOffset(-123, 0)).toBe(0)
    expect(wrapTrackOffset(-123, -10)).toBe(0)
    expect(wrapTrackOffset(-123, Number.NaN)).toBe(0)
  })
})

describe('порог «клик или перетаскивание»', () => {
  it('меньше порога по обеим осям — это клик', () => {
    expect(isDragGesture(2, -3, 5)).toBe(false)
    expect(isDragGesture(0, 0, 5)).toBe(false)
  })

  it('больше порога хотя бы по одной оси — перетаскивание', () => {
    expect(isDragGesture(6, 0, 5)).toBe(true)
    expect(isDragGesture(0, -6, 5)).toBe(true)
  })

  it('ровно порог — ещё не перетаскивание', () => {
    expect(isDragGesture(5, 5, 5)).toBe(false)
  })
})
