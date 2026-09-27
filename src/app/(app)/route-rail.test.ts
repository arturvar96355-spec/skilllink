import { describe, expect, it } from 'vitest'
import type { CooperationListItemDto } from '@/shared/contracts'
import {
  COLUMN_MAX,
  ROUTE_GEOMETRY,
  TOTAL_STAGES,
  columnSplit,
  countLabel,
  countText,
  counterSize,
  estimateTextWidth,
  groupByStage,
  placeStageLabels,
  routeLayout,
  type RouteView,
} from './route-rail'

let serial = 0

/** Связка на этапе — только поля, которые читает маршрут. */
function coop(stage: number | null, university: string, options: { stuck?: boolean; short?: string | null } = {}) {
  serial += 1
  return {
    id: `c${serial}`,
    universityId: university,
    universityName: `Университет ${university}`,
    universityShortName: options.short === undefined ? university : options.short,
    programName: `Программа ${serial}`,
    currentStage: stage === null ? null : { stageNumber: stage, title: `Этап ${stage}` },
    progress: { overdueStages: options.stuck ? 1 : 0, blockedStages: 0 },
  } as unknown as CooperationListItemDto
}

/** N связок на одном этапе, вузы по кругу. */
function crowd(stage: number, count: number, universities = ['КубГТУ', 'ПГУТИ', 'ОмГТУ', 'СФУ']) {
  return Array.from({ length: count }, (_, index) => coop(stage, universities[index % universities.length]!))
}

/** Как на главной сейчас (скриншот владельца): 13 на первом этапе и хвост по маршруту. */
function today() {
  return [
    ...crowd(1, 11, ['КубГТУ']),
    ...crowd(2, 3, ['ПГУТИ']),
    ...crowd(3, 3, ['ОмГТУ']),
    coop(4, 'СФУ'),
    ...crowd(5, 2, ['ДВФУ']),
    ...crowd(6, 2, ['ОмГТУ']),
    coop(7, 'МТУСИ', { stuck: true }),
  ]
}

const WIDTHS = [1100, 700, 326]
const VIEWS: RouteView[] = ['count', 'column']
const within = (value: number, min: number, max: number) => value >= min - 1e-6 && value <= max + 1e-6

describe('маршрут связок: группировка по этапам', () => {
  it('одна отметка на этап, по возрастанию этапа; без текущего этапа — не на маршруте', () => {
    const groups = groupByStage([coop(3, 'А'), coop(1, 'Б'), coop(3, 'В'), coop(null, 'Г')])
    expect(groups.map((group) => [group.stage, group.count])).toEqual([
      [1, 1],
      [3, 2],
    ])
  })

  it.each([1, 12, 30])('%i связок на одном этапе — одна группа, все связки на месте', (count) => {
    const items = crowd(1, count)
    const [group] = groupByStage(items)
    expect(group!.count).toBe(count)
    expect(new Set(group!.items.map((item) => item.id))).toEqual(new Set(items.map((item) => item.id)))
  })

  it('ведущий вуз — сначала самый проблемный, затем самый крупный', () => {
    const calm = [coop(1, 'Крупный'), coop(1, 'Крупный'), coop(1, 'Крупный'), coop(1, 'Малый')]
    expect(groupByStage(calm)[0]!.leadName).toBe('Крупный')

    const withProblem = [...calm, coop(1, 'Проблемный', { stuck: true })]
    const [group] = groupByStage(withProblem)
    expect(group!.leadName).toBe('Проблемный')
    expect(group!.items[0]!.universityId).toBe('Проблемный')
    expect(group!.stuckCount).toBe(1)
  })

  it('требующие внимания — сразу за ведущей: в столбик и в начало списка', () => {
    const items = [coop(2, 'А'), coop(2, 'А'), coop(2, 'Б', { stuck: true }), coop(2, 'В', { stuck: true })]
    const [group] = groupByStage(items)
    expect(group!.items.slice(0, 2).every((item) => item.progress.overdueStages > 0)).toBe(true)
  })

  it('нет краткого названия — полное', () => {
    expect(groupByStage([coop(1, 'А', { short: null })])[0]!.leadName).toBe('Университет А')
  })

  it('подпись «вуз и ещё N» и число в точке', () => {
    expect(countLabel({ count: 12, leadName: 'КубГТУ' })).toBe('КубГТУ и ещё 11')
    expect(countLabel({ count: 1, leadName: 'СФУ' })).toBe('СФУ')
    expect(countText(30)).toBe('30')
    expect(countText(140)).toBe('99+')
  })
})

describe('маршрут связок: размеры отметок', () => {
  it('точка-счётчик растёт с числом, но в пределах и не шире этапа', () => {
    const wide = 1100 / TOTAL_STAGES
    const sizes = [1, 2, 5, 12, 30, 200].map((count) => counterSize(count, wide))
    sizes.slice(1).forEach((size, index) => expect(size).toBeGreaterThanOrEqual(sizes[index]!))
    expect(Math.max(...sizes)).toBeLessThanOrEqual(26)
    for (const width of WIDTHS) {
      const stage = width / TOTAL_STAGES
      for (const count of [1, 12, 30]) expect(counterSize(count, stage)).toBeLessThanOrEqual(stage - 2)
    }
  })

  it.each([
    [1, 1, 0],
    [12, COLUMN_MAX, 7],
    [30, COLUMN_MAX, 25],
  ])('столбик из %i связок: %i точек и «+%i»', (count, dots, more) => {
    expect(columnSplit(count)).toEqual({ dots, more })
  })
})

describe('маршрут связок: раскладка', () => {
  const cases = VIEWS.flatMap((view) =>
    WIDTHS.flatMap((width) => [1, 12, 30].map((count) => ({ view, width, count }))),
  )

  it.each(cases)('$view, $width px, $count на первом этапе: всё в рамке и без наложений', ({ view, width, count }) => {
    const groups = groupByStage([...crowd(1, count), ...today().filter((item) => item.currentStage!.stageNumber > 1)])
    const layout = routeLayout(groups, view, width)

    // Прямоугольники отметок.
    const boxes = layout.stages.flatMap(({ x, marker }) =>
      marker.view === 'count'
        ? [{ left: x - marker.size / 2, right: x + marker.size / 2, top: layout.lineY - marker.size / 2, bottom: layout.lineY + marker.size / 2 }]
        : marker.dots.map(({ y }) => ({
            left: x - ROUTE_GEOMETRY.dot / 2,
            right: x + ROUTE_GEOMETRY.dot / 2,
            top: y - ROUTE_GEOMETRY.dot / 2,
            bottom: y + ROUTE_GEOMETRY.dot / 2,
          })),
    )
    // «+N» над столбиком — тоже место, на которое подпись налезать не должна.
    const moreBoxes = layout.stages.flatMap(({ x, marker }) => {
      if (marker.view !== 'column' || marker.moreTop === null) return []
      const half = (estimateTextWidth(`+${marker.more}`) + 8) / 2
      return [{ left: x - half, right: x + half, top: marker.moreTop, bottom: marker.moreTop + ROUTE_GEOMETRY.moreHeight }]
    })
    for (const box of moreBoxes) expect(box.top).toBeGreaterThanOrEqual(0)
    for (const box of boxes) {
      expect(within(box.left, 0, width) && within(box.right, 0, width)).toBe(true)
      expect(box.top).toBeGreaterThanOrEqual(0)
    }
    boxes.forEach((a, i) =>
      boxes.slice(i + 1).forEach((b) => {
        const overlap = a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
        expect(overlap).toBe(false)
      }),
    )

    // Подписи — в ширине шкалы, не выше дорожки, не друг на друге и не на отметках.
    for (const label of layout.labels) {
      expect(within(label.left, 0, width) && within(label.left + label.width, 0, width)).toBe(true)
      expect(label.top).toBeGreaterThanOrEqual(0)
      const rect = { left: label.left, right: label.left + label.width, top: label.top, bottom: label.top + ROUTE_GEOMETRY.labelHeight }
      for (const box of [...boxes, ...moreBoxes]) {
        const overlap = rect.left < box.right && box.left < rect.right && rect.top < box.bottom && box.top < rect.bottom
        expect(overlap).toBe(false)
      }
    }
    layout.labels.forEach((a, i) =>
      layout.labels.slice(i + 1).forEach((b) => {
        const sameRow = a.top < b.top + ROUTE_GEOMETRY.labelHeight && b.top < a.top + ROUTE_GEOMETRY.labelHeight
        if (sameRow) expect(a.left + a.width <= b.left || b.left + b.width <= a.left).toBe(true)
      }),
    )

    // Число связок на маршруте не теряется: каждая либо точкой, либо в числе / «+N».
    const shown = layout.stages.reduce(
      (sum, { group, marker }) => sum + (marker.view === 'count' ? group.count : marker.dots.length + marker.more),
      0,
    )
    expect(shown).toBe(groups.reduce((sum, group) => sum + group.count, 0))
  })

  it('на широкой шкале первый этап подписан полностью: «КубГТУ и ещё 10»', () => {
    const layout = routeLayout(groupByStage(today()), 'count', 1100)
    expect(layout.labels.find((label) => label.key === 1)?.text).toBe('КубГТУ и ещё 10')
  })

  it('в столбике подпись — вуз верхней точки', () => {
    const layout = routeLayout(groupByStage(today()), 'column', 1100)
    const first = layout.stages[0]!
    expect(first.marker.view).toBe('column')
    if (first.marker.view !== 'column') return
    expect(first.marker.dots).toHaveLength(COLUMN_MAX)
    expect(first.marker.more).toBe(6)
    expect(first.marker.dots.at(-1)!.item.universityShortName).toBe(layout.labels.find((label) => label.key === 1)?.text)
  })

  it('подписи, которым не хватило места, прячутся — сначала менее важные', () => {
    const placed = placeStageLabels(
      [
        { key: 1, x: 50, top: 0, texts: ['Очень длинная подпись'], weight: 1 },
        { key: 2, x: 60, top: 0, texts: ['Важная'], weight: 1000 },
      ],
      { width: 200, height: 16, measure: (text) => text.length * 7 },
    )
    expect(placed.map((label) => label.key)).toEqual([2])
  })

  it('не влез полный текст — ставится короткий', () => {
    const placed = placeStageLabels(
      [
        { key: 1, x: 40, top: 0, texts: ['Важная подпись'], weight: 10 },
        { key: 2, x: 130, top: 0, texts: ['КубГТУ и ещё 11', 'КубГТУ'], weight: 1 },
      ],
      { width: 200, height: 16, measure: (text) => text.length * 7 },
    )
    expect(placed.find((label) => label.key === 2)?.text).toBe('КубГТУ')
  })
})
