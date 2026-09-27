import { describe, expect, it } from 'vitest'
import {
  CLUSTER_DISTANCE,
  clusterPoints,
  clusterTitle,
  overlaps,
  placeFloating,
  placeLabels,
  type ClusterInput,
} from './map-clusters'
import { projectRussia } from './russia-map'

const at = (key: string, city: string, lat: number, lon: number, value = 5, active = true): ClusterInput => ({
  key,
  label: key,
  city,
  ...projectRussia(lat, lon),
  value,
  active,
})

const KAI = at('КНИТУ-КАИ', 'Казань', 55.796, 49.106, 5, true)
const INNO = at('Иннополис', 'Иннополис', 55.752, 48.744, 5, true)
const NNGU = at('ННГУ', 'Нижний Новгород', 56.327, 44.006, 5, true)
const MTUSI = at('МТУСИ', 'Москва', 55.756, 37.617, 5, true)

describe('кучки вузов на карте', () => {
  it('Казань и Иннополис — одна кучка, подписанная Казанью', () => {
    const clusters = clusterPoints([KAI, INNO, NNGU])
    expect(clusters).toHaveLength(2)
    const kazan = clusters.find((cluster) => cluster.members.length === 2)!
    expect(kazan.members.map((point) => point.key).sort()).toEqual(['Иннополис', 'КНИТУ-КАИ'])
    expect(kazan.city).toBe('Казань')
    expect(clusterTitle(kazan)).toBe('Казань · 2 вуза')
    expect(kazan.value).toBe(10)
  })

  it('Казань и Нижний Новгород дальше порога — разные точки', () => {
    const clusters = clusterPoints([KAI, NNGU])
    expect(clusters.map((cluster) => cluster.members.length)).toEqual([1, 1])
    expect(Math.hypot(KAI.x - NNGU.x, KAI.y - NNGU.y)).toBeGreaterThan(CLUSTER_DISTANCE)
  })

  it('вузы одного города — одна кучка даже при разных координатах', () => {
    const a = { ...MTUSI, key: 'a' }
    const b = { ...MTUSI, key: 'b', x: MTUSI.x + 40 }
    const clusters = clusterPoints([a, b])
    expect(clusters).toHaveLength(1)
    expect(clusterTitle(clusters[0]!)).toBe('Москва · 2 вуза')
  })

  it('объединяет по цепочке и склоняет число вузов', () => {
    const points = Array.from({ length: 5 }, (_, i) => ({
      ...MTUSI,
      key: `m${i}`,
      label: `m${i}`,
      city: undefined,
      x: MTUSI.x + i * 6,
    }))
    const [cluster] = clusterPoints(points)
    expect(cluster!.members).toHaveLength(5)
    // Без города — по имени самого крупного (здесь — первого) вуза.
    expect(clusterTitle(cluster!)).toBe('m0 и ещё 4')
    expect(clusterTitle({ ...cluster!, city: 'Москва' })).toBe('Москва · 5 вузов')
  })

  it('одиночная точка остаётся собой: ключ, место и подпись вуза', () => {
    const [single] = clusterPoints([NNGU])
    expect(single!.key).toBe('ННГУ')
    expect(single!.x).toBe(NNGU.x)
    expect(clusterTitle(single!)).toBe('ННГУ')
  })

  it('центр кучки — средневзвешенный по связкам, крупный вуз первым', () => {
    const big = { ...KAI, value: 9 }
    const small = { ...INNO, value: 1 }
    const [cluster] = clusterPoints([small, big])
    expect(cluster!.members[0]!.key).toBe('КНИТУ-КАИ')
    expect(cluster!.x).toBeCloseTo((big.x * 9 + small.x) / 10, 5)
    // Город — самого крупного вуза при равном числе вузов в городах.
    expect(cluster!.city).toBe('Казань')
  })

  it('кучка в работе, если в работе хоть один вуз; без связок не падает в (0, 0)', () => {
    const [cluster] = clusterPoints([
      { ...KAI, value: 0, active: false },
      { ...INNO, value: 0, active: true },
    ])
    expect(cluster!.active).toBe(true)
    expect(cluster!.x).toBeGreaterThan(100)
    const [idle] = clusterPoints([
      { ...KAI, active: false },
      { ...INNO, active: false },
    ])
    expect(idle!.active).toBe(false)
  })

  it('порядок кучек повторяет входной', () => {
    const clusters = clusterPoints([NNGU, KAI, MTUSI, INNO])
    expect(clusters.map((cluster) => cluster.members.length)).toEqual([1, 2, 1])
    expect(clusters[0]!.key).toBe('ННГУ')
  })
})

describe('подписи на карте', () => {
  const metrics = { size: 16, charWidth: 16 * 0.68 }
  const field = { width: 1000, height: 545 }

  it('подписи не налезают друг на друга; менее важная прячется', () => {
    const candidates = [
      {
        key: 'важная',
        text: 'ОЧЕНЬ ДЛИННАЯ',
        x: 200,
        y: 200,
        r: 6,
        weight: 10,
      },
      { key: 'соседка', text: 'СОСЕДКА', x: 206, y: 204, r: 6, weight: 1 },
      { key: 'далёкая', text: 'ДАЛЁКАЯ', x: 800, y: 300, r: 6, weight: 1 },
    ]
    const spots = placeLabels(candidates, metrics, field)
    expect(spots.has('важная')).toBe(true)
    expect(spots.has('далёкая')).toBe(true)
    const boxes = [...spots.values()].map((spot) => spot.box)
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) expect(overlaps(boxes[i]!, boxes[j]!)).toBe(false)
    }
  })

  it('крупный кегль (телефон) прячет больше подписей, чем мелкий', () => {
    const european = [
      KAI,
      NNGU,
      MTUSI,
      at('СПбГУТ', 'Санкт-Петербург', 59.939, 30.316),
      at('ПГУТИ', 'Самара', 53.195, 50.101),
      at('УУНиТ', 'Уфа', 54.735, 55.958),
      at('ПНИПУ', 'Пермь', 58.01, 56.229),
      at('УрФУ', 'Екатеринбург', 56.838, 60.597),
      at('ВГУ', 'Воронеж', 51.661, 39.2),
    ]
    // На телефоне поле ≈ 330 px: кегль 12 px — 36 единиц, точка 4 px — 12 единиц.
    const on = (r: number) =>
      european.map((point, index) => ({
        key: point.key,
        text: point.label,
        x: point.x,
        y: point.y,
        r,
        weight: 10 - index,
      }))
    const desktop = placeLabels(on(6), { size: 16, charWidth: 16 * 0.68 }, field)
    const phone = placeLabels(on(12), { size: 36, charWidth: 36 * 0.68 }, field)
    expect(phone.size).toBeLessThan(desktop.size)
    // Подписано хоть что-то, и подписи по-прежнему не пересекаются.
    expect(phone.size).toBeGreaterThan(0)
    const boxes = [...phone.values()].map((spot) => spot.box)
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) expect(overlaps(boxes[i]!, boxes[j]!)).toBe(false)
    }
  })

  it('подпись не выходит за край поля', () => {
    const spots = placeLabels([{ key: 'край', text: 'У САМОГО КРАЯ', x: 995, y: 5, r: 4, weight: 1 }], metrics, field)
    const spot = spots.get('край')
    if (spot) {
      expect(spot.box.x2).toBeLessThanOrEqual(field.width)
      expect(spot.box.y1).toBeGreaterThanOrEqual(0)
    }
  })
})

describe('всплывающее окно у точки', () => {
  const field = { width: 330, height: 180 }
  it('над точкой, по центру, внутри блока', () => {
    expect(placeFloating({ x: 165, y: 150 }, { width: 100, height: 60 }, field)).toEqual({ left: 115, top: 76, below: false })
  })
  it('у левого края прижимается к краю, у верхнего — уходит вниз', () => {
    const place = placeFloating({ x: 10, y: 20 }, { width: 200, height: 60 }, field)
    expect(place.left).toBe(0)
    expect(place.below).toBe(true)
    expect(place.top).toBe(34)
  })
  it('у правого края не вылезает', () => {
    expect(placeFloating({ x: 320, y: 150 }, { width: 200, height: 60 }, field).left).toBe(130)
  })
})
