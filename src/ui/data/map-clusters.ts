/**
 * Чистая логика карты вузов (решение 198): кучки близких вузов, раскладка
 * подписей без наложений и место для всплывающего окна. Без React и DOM —
 * проверяется тестом `map-clusters.test.ts`.
 *
 * Координаты — в единицах поля карты (`RUSSIA_VIEWBOX`, 1000 × 545;
 * одна единица — примерно 8 км на широте Москвы).
 */
import { pluralize } from '../lib/format'

export interface ClusterInput {
  key: string
  /** Короткое имя вуза — подпись одиночной точки. */
  label: string
  /** Город вуза; нет — кучка подписывается по имени первого вуза. */
  city?: string
  x: number
  y: number
  /** Число связок вуза. */
  value: number
  /** Есть связки в работе. */
  active?: boolean
}

export interface MapCluster<T extends ClusterInput> {
  /** Ключ одиночного вуза или `cluster:` + ключи вузов кучки. */
  key: string
  x: number
  y: number
  /** Вузы кучки: самые крупные первыми. У одиночной точки — один. */
  members: T[]
  /** Город, которым подписана кучка («Казань · 2 вуза»). */
  city: string | null
  /** Сумма связок вузов кучки. */
  value: number
  active: boolean
}

/**
 * Порог объединения — 10 единиц поля, около 80 км: Казань и Иннополис (≈ 3)
 * и Ростов и Таганрог (≈ 8) — одна кучка, Казань и Нижний Новгород (≈ 40) —
 * разные точки. Вузы одного города объединяются при любом расстоянии.
 */
export const CLUSTER_DISTANCE = 10

/**
 * Кучки: вузы одного города или ближе `threshold` друг к другу — одна точка.
 * Связность «по цепочке»: A рядом с B, B рядом с C — все трое в одной кучке.
 * Порядок кучек — как у первого вуза кучки во входном списке.
 */
export function clusterPoints<T extends ClusterInput>(points: T[], threshold = CLUSTER_DISTANCE): MapCluster<T>[] {
  const parent = points.map((_, index) => index)
  const find = (index: number): number => {
    while (parent[index] !== index) {
      parent[index] = parent[parent[index]!]!
      index = parent[index]!
    }
    return index
  }
  const union = (a: number, b: number) => {
    const rootA = find(a)
    const rootB = find(b)
    // Корень — меньший номер: порядок кучек повторяет входной.
    if (rootA !== rootB) parent[Math.max(rootA, rootB)] = Math.min(rootA, rootB)
  }

  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      const a = points[i]!
      const b = points[j]!
      const sameCity = a.city !== undefined && b.city !== undefined && a.city.trim() === b.city.trim()
      if (sameCity || Math.hypot(a.x - b.x, a.y - b.y) <= threshold) union(i, j)
    }
  }

  const groups = new Map<number, T[]>()
  points.forEach((point, index) => {
    const root = find(index)
    const list = groups.get(root) ?? []
    list.push(point)
    groups.set(root, list)
  })

  return [...groups.values()].map((list) => {
    // Крупные первыми; при равенстве — входной порядок (сортировка устойчива).
    const members = [...list].sort((a, b) => b.value - a.value)
    const value = members.reduce((sum, point) => sum + point.value, 0)
    const lead = members[0]!
    if (members.length === 1) {
      return {
        key: lead.key,
        x: lead.x,
        y: lead.y,
        members,
        city: lead.city?.trim() || null,
        value,
        active: lead.active !== false,
      }
    }
    // Центр кучки — средневзвешенный по числу связок; у пустых вузов вес 1,
    // иначе кучка из вузов без связок встала бы в точку (0, 0).
    const weights = members.map((point) => Math.max(point.value, 1))
    const total = weights.reduce((sum, weight) => sum + weight, 0)
    const x = members.reduce((sum, point, index) => sum + point.x * weights[index]!, 0) / total
    const y = members.reduce((sum, point, index) => sum + point.y * weights[index]!, 0) / total
    return {
      key: `cluster:${members.map((point) => point.key).join('+')}`,
      x,
      y,
      members,
      city: clusterCity(members),
      value,
      active: members.some((point) => point.active !== false),
    }
  })
}

/**
 * Город кучки: самый частый среди её вузов; при равенстве — город самого
 * крупного вуза, дальше — первого по входному списку (главная получает вузы
 * по алфавиту полного названия: «Казанский…» раньше «Университет Иннополис»).
 */
function clusterCity(members: ClusterInput[]): string | null {
  const counts = new Map<string, { count: number; order: number }>()
  members.forEach((point, order) => {
    const city = point.city?.trim()
    if (!city) return
    const entry = counts.get(city)
    if (entry) entry.count += 1
    else counts.set(city, { count: 1, order })
  })
  let best: string | null = null
  let bestCount = 0
  let bestOrder = Infinity
  for (const [city, { count, order }] of counts) {
    if (count > bestCount || (count === bestCount && order < bestOrder)) {
      best = city
      bestCount = count
      bestOrder = order
    }
  }
  return best
}

const UNIVERSITY_FORMS: [string, string, string] = ['вуз', 'вуза', 'вузов']

/** «Казань · 2 вуза»; без города — «КНИТУ-КАИ и ещё 1». Для одиночной точки — имя вуза. */
export function clusterTitle(cluster: MapCluster<ClusterInput>): string {
  const count = cluster.members.length
  if (count === 1) return cluster.members[0]!.label
  if (cluster.city) return `${cluster.city} · ${count} ${pluralize(count, UNIVERSITY_FORMS)}`
  return `${cluster.members[0]!.label} и ещё ${count - 1}`
}

export interface Box {
  x1: number
  y1: number
  x2: number
  y2: number
}

export interface LabelSpot {
  x: number
  y: number
  anchor: 'start' | 'end' | 'middle'
  text: string
  box: Box
}

export interface LabelCandidate {
  key: string
  text: string
  x: number
  y: number
  /** Радиус точки в единицах поля — подпись не заходит на неё. */
  r: number
  /** Чем больше, тем раньше ставится подпись; не хватило места — прячется. */
  weight: number
}

/** Размер подписи в единицах поля: кегль и примерная ширина знака. */
export interface LabelMetrics {
  size: number
  /** С запасом: кириллица полужирная и с обводкой шире латиницы. */
  charWidth: number
}

export const overlaps = (a: Box, b: Box) => a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2

/**
 * Раскладка подписей (решения 130, 198). Подпись пробует встать справа, слева,
 * сверху и снизу от точки — туда, где не задевает уже поставленные подписи,
 * чужие точки и край поля. Важные (со связками в работе, с большим числом
 * связок) ставятся первыми; менее важной не хватило места — точка без подписи,
 * имя остаётся в подсказке и в `aria-label`.
 */
export function placeLabels(
  candidates: LabelCandidate[],
  metrics: LabelMetrics,
  field: { width: number; height: number },
): Map<string, LabelSpot> {
  const dots: Box[] = candidates.map((c) => ({
    x1: c.x - c.r,
    y1: c.y - c.r,
    x2: c.x + c.r,
    y2: c.y + c.r,
  }))
  const taken: Box[] = []
  const spots = new Map<string, LabelSpot>()
  const { size, charWidth } = metrics
  const ascent = size * 0.78
  const descent = size * 0.3
  const order = candidates
    .map((candidate, index) => ({ candidate, index }))
    .sort((a, b) => b.candidate.weight - a.candidate.weight)
  for (const { candidate: c, index } of order) {
    const width = c.text.length * charWidth + size * 0.4
    const gap = c.r + size * 0.3
    const baseline = c.y + size * 0.32
    const options: LabelSpot[] = [
      {
        x: c.x + gap,
        y: baseline,
        anchor: 'start',
        text: c.text,
        box: {
          x1: c.x + gap,
          y1: baseline - ascent,
          x2: c.x + gap + width,
          y2: baseline + descent,
        },
      },
      {
        x: c.x - gap,
        y: baseline,
        anchor: 'end',
        text: c.text,
        box: {
          x1: c.x - gap - width,
          y1: baseline - ascent,
          x2: c.x - gap,
          y2: baseline + descent,
        },
      },
      {
        x: c.x,
        y: c.y - gap - descent,
        anchor: 'middle',
        text: c.text,
        box: {
          x1: c.x - width / 2,
          y1: c.y - gap - descent - ascent,
          x2: c.x + width / 2,
          y2: c.y - gap,
        },
      },
      {
        x: c.x,
        y: c.y + gap + ascent,
        anchor: 'middle',
        text: c.text,
        box: {
          x1: c.x - width / 2,
          y1: c.y + gap,
          x2: c.x + width / 2,
          y2: c.y + gap + ascent + descent,
        },
      },
    ]
    const spot = options.find(
      (option) =>
        option.box.x1 >= 0 &&
        option.box.x2 <= field.width &&
        option.box.y1 >= 0 &&
        option.box.y2 <= field.height &&
        !taken.some((box) => overlaps(box, option.box)) &&
        !dots.some((box, dotIndex) => dotIndex !== index && overlaps(box, option.box)),
    )
    if (!spot) continue
    taken.push(spot.box)
    spots.set(c.key, spot)
  }
  return spots
}

/**
 * Где поставить всплывающее окно размером `size` у точки `anchor` в блоке
 * `field` (всё в пикселях): над точкой, а если сверху не хватает места — под
 * ней; по горизонтали по центру точки, но целиком внутри блока.
 */
export function placeFloating(
  anchor: { x: number; y: number },
  size: { width: number; height: number },
  field: { width: number; height: number },
  gap = 14,
): { left: number; top: number; below: boolean } {
  const left = Math.max(0, Math.min(anchor.x - size.width / 2, field.width - size.width))
  const above = anchor.y - gap - size.height
  const below = above < 0
  return { left, top: below ? anchor.y + gap : above, below }
}
