import { describe, expect, it } from 'vitest'
import { START_ANGLE, TAU, donutArcs, nextSector, ringSectorPath, sectorOffset, sharePercent } from './donut-geometry'

describe('сектора кольца', () => {
  it('делят круг пропорционально значениям и начинаются с «12 часов»', () => {
    const arcs = donutArcs([3, 1])
    expect(arcs).toHaveLength(2)
    expect(arcs[0]!.a0).toBeCloseTo(START_ANGLE)
    expect(arcs[0]!.a1 - arcs[0]!.a0).toBeCloseTo(TAU * 0.75)
    expect(arcs[1]!.a0).toBeCloseTo(arcs[0]!.a1)
    expect(arcs[1]!.a1).toBeCloseTo(START_ANGLE + TAU)
    expect(arcs.map((arc) => arc.share)).toEqual([0.75, 0.25])
  })

  it('сумма долей — единица', () => {
    const arcs = donutArcs([19, 20, 21, 11, 6])
    expect(arcs.reduce((sum, arc) => sum + arc.share, 0)).toBeCloseTo(1)
  })

  it('нулевые, отрицательные и нечисловые значения сектора не получают, но номер сохраняют', () => {
    const arcs = donutArcs([0, 5, -2, Number.NaN, 5])
    expect(arcs.map((arc) => arc.index)).toEqual([1, 4])
    expect(arcs[0]!.share).toBeCloseTo(0.5)
  })

  it('пустые данные — ни одного сектора', () => {
    expect(donutArcs([])).toEqual([])
    expect(donutArcs([0, 0])).toEqual([])
  })

  it('зазор есть только между соседями: одиночный сектор — полный круг', () => {
    const single = donutArcs([7], 0.05)
    expect(single[0]!.a1 - single[0]!.a0).toBeCloseTo(TAU)

    const pair = donutArcs([1, 1], 0.05)
    expect(pair[0]!.a1 - pair[0]!.a0).toBeCloseTo(Math.PI - 0.05)
    // Середина считается без зазора — сектор выдвигается строго по своей оси.
    expect(pair[0]!.mid).toBeCloseTo(START_ANGLE + Math.PI / 2)
  })

  it('зазор не съедает крошечный сектор', () => {
    const arcs = donutArcs([1000, 1], 0.05)
    expect(arcs[1]!.a1).toBeGreaterThan(arcs[1]!.a0)
  })
})

describe('контур сектора', () => {
  it('сектор меньше половины — малая дуга, больше — большая', () => {
    expect(ringSectorPath(100, 100, 50, 90, 0, Math.PI / 2)).toMatch(/A90 90 0 0 1/)
    expect(ringSectorPath(100, 100, 50, 90, 0, Math.PI * 1.5)).toMatch(/A90 90 0 1 1/)
  })

  it('полный круг рисуется двумя половинами на каждом радиусе', () => {
    const d = ringSectorPath(100, 100, 50, 90, START_ANGLE, START_ANGLE + TAU)
    expect(d.match(/A90 90/g)).toHaveLength(2)
    expect(d.match(/A50 50/g)).toHaveLength(2)
  })

  it('пустой сектор — пустой контур', () => {
    expect(ringSectorPath(100, 100, 50, 90, 1, 1)).toBe('')
  })

  it('выдвижение — по середине сектора', () => {
    expect(sectorOffset(0, 6)).toEqual({ x: 6, y: 0 })
    expect(sectorOffset(-Math.PI / 2, 6)).toEqual({ x: 0, y: -6 })
  })
})

describe('доли в подписях', () => {
  it('одна цифра после запятой, по-русски', () => {
    expect(sharePercent(19, 77)).toBe('24,7%')
    expect(sharePercent(20, 77)).toBe('26%')
  })

  it('нет суммы — нет доли (а не «0%»)', () => {
    expect(sharePercent(0, 0)).toBeNull()
  })
})

describe('клавиатура', () => {
  it('стрелки ходят по кругу, Home/End — к краям', () => {
    expect(nextSector(0, 3, 'ArrowRight')).toBe(1)
    expect(nextSector(2, 3, 'ArrowDown')).toBe(0)
    expect(nextSector(0, 3, 'ArrowLeft')).toBe(2)
    expect(nextSector(1, 3, 'Home')).toBe(0)
    expect(nextSector(0, 3, 'End')).toBe(2)
    expect(nextSector(0, 3, 'Enter')).toBeNull()
    expect(nextSector(0, 0, 'ArrowRight')).toBeNull()
  })
})
