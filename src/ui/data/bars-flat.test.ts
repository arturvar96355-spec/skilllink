import { describe, expect, it } from 'vitest'
import { placeBarTip, stepIndex } from './bars-flat'

const tip = { width: 180, height: 80 }
const overlaps = (a: { left: number; width: number }, pair: { left: number; right: number }) =>
  a.left < pair.right && a.left + a.width > pair.left

describe('подсказка столбиков', () => {
  it('по умолчанию — справа от пары, на уровне её верха', () => {
    const at = placeBarTip({ left: 100, right: 150, top: 60 }, tip, { width: 960, floor: 218 })
    expect(at).toEqual({ left: 162, top: 50, side: 'right' })
  })

  it('у правого края переворачивается влево и не ложится на пару', () => {
    const pair = { left: 860, right: 910, top: 60 }
    const at = placeBarTip(pair, tip, { width: 960, floor: 218 })
    expect(at.side).toBe('left')
    expect(at.left + tip.width).toBeLessThanOrEqual(pair.left)
    expect(at.left).toBeGreaterThanOrEqual(0)
  })

  it('на узком блоке, где нет места по бокам, встаёт над невысокой парой', () => {
    const pair = { left: 150, right: 176, top: 150 }
    const at = placeBarTip(pair, tip, { width: 330, floor: 218 })
    expect(at.side).toBe('above')
    expect(at.top + tip.height).toBeLessThanOrEqual(pair.top)
    expect(at.left).toBeGreaterThanOrEqual(0)
    expect(at.left + tip.width).toBeLessThanOrEqual(330)
  })

  it('если и над высокой парой нет места — уходит под пол, не ложась на пару', () => {
    const pair = { left: 150, right: 176, top: 60 }
    const at = placeBarTip(pair, tip, { width: 330, floor: 218, bottom: 340 })
    expect(at.side).toBe('below')
    expect(at.top).toBeGreaterThanOrEqual(218)
    expect(at.top + tip.height).toBeLessThanOrEqual(340)
    expect(at.left + tip.width).toBeLessThanOrEqual(330)
  })

  it('в крайнем случае прижимается к краю, но не выходит за блок', () => {
    const pair = { left: 150, right: 176, top: 34 }
    const at = placeBarTip(pair, tip, { width: 330, floor: 218 })
    expect(at.side).toBe('clamped')
    expect(at.left).toBeGreaterThanOrEqual(0)
    expect(at.left + tip.width).toBeLessThanOrEqual(330)
  })

  it('по высоте не опускается ниже пола и не поднимается выше блока', () => {
    const low = placeBarTip({ left: 100, right: 150, top: 216 }, tip, { width: 960, floor: 218 })
    expect(low.top + tip.height).toBeLessThanOrEqual(218)
    const high = placeBarTip({ left: 100, right: 150, top: 2 }, tip, { width: 960, floor: 218 })
    expect(high.top).toBe(0)
  })

  it('сбоку никогда не перекрывает пару', () => {
    for (let x = 0; x <= 900; x += 30) {
      const pair = { left: x, right: x + 50, top: 80 }
      const at = placeBarTip(pair, tip, { width: 960, floor: 218 })
      expect(overlaps({ left: at.left, width: tip.width }, pair)).toBe(false)
    }
  })
})

describe('стрелки по вузам', () => {
  it('ходят на один и не выходят за края', () => {
    expect(stepIndex('ArrowRight', 0, 5)).toBe(1)
    expect(stepIndex('ArrowRight', 4, 5)).toBe(4)
    expect(stepIndex('ArrowLeft', 0, 5)).toBe(0)
    expect(stepIndex('ArrowLeft', 3, 5)).toBe(2)
  })

  it('Home и End — к первому и последнему; прочие клавиши не трогают', () => {
    expect(stepIndex('Home', 3, 5)).toBe(0)
    expect(stepIndex('End', 1, 5)).toBe(4)
    expect(stepIndex('Enter', 1, 5)).toBeNull()
    expect(stepIndex('ArrowRight', 0, 0)).toBeNull()
  })
})
