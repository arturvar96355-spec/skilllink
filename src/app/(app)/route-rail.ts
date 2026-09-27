import type { CooperationListItemDto } from '@/shared/contracts'

/**
 * Маршрут связок в «Активно сейчас» (решение 202): чистая логика без React.
 *
 * Раньше связки одного этапа вставали в ряд по 14 px от центра этапа: на
 * «Привлечении» двенадцать точек уходили за начало шкалы и наезжали на соседние
 * этапы вместе с подписями. Теперь у этапа одно место на шкале, а вид этого
 * места — вариант:
 * - `count` — одна точка на этап, при двух и больше связках — число внутри;
 * - `column` — точки этапа столбиком вверх, не больше пяти, выше — «+N».
 */

export type RouteView = 'count' | 'column'

export const TOTAL_STAGES = 14

/** Больше точек столбик не держит: выше — «+N». */
export const COLUMN_MAX = 5

export interface StageGroup {
  stage: number
  /** Связки этапа: первая — «ведущая» (её вуз в подписи), дальше требующие внимания, дальше как пришли. */
  items: CooperationListItemDto[]
  count: number
  /** Сколько связок этапа требуют внимания (просрочка или блок). */
  stuckCount: number
  /** Вуз ведущей связки — для подписи этапа. */
  leadName: string
}

export function universityLabel(item: CooperationListItemDto): string {
  return item.universityShortName ?? item.universityName
}

export function isStuck(item: CooperationListItemDto): boolean {
  return item.progress.overdueStages > 0 || item.progress.blockedStages > 0
}

/**
 * Связки по этапам маршрута — по возрастанию номера этапа. Связки без текущего
 * этапа (все этапы закрыты) на маршруте не стоят.
 *
 * Ведущий вуз этапа — «самый проблемный, затем самый крупный»: больше всего
 * связок, требующих внимания; при равенстве — больше всего связок на этапе;
 * дальше — тот, что встретился первым (главная получает связки по свежести).
 */
export function groupByStage(cooperations: readonly CooperationListItemDto[]): StageGroup[] {
  const byStage = new Map<number, CooperationListItemDto[]>()
  for (const item of cooperations) {
    const stage = item.currentStage?.stageNumber
    if (stage === undefined) continue
    const list = byStage.get(stage)
    if (list) list.push(item)
    else byStage.set(stage, [item])
  }

  return [...byStage.entries()]
    .sort(([a], [b]) => a - b)
    .map(([stage, list]) => {
      const perUniversity = new Map<string, { stuck: number; total: number; first: number }>()
      list.forEach((item, index) => {
        const entry = perUniversity.get(item.universityId) ?? { stuck: 0, total: 0, first: index }
        entry.total += 1
        if (isStuck(item)) entry.stuck += 1
        perUniversity.set(item.universityId, entry)
      })
      let leadUniversity = list[0]!.universityId
      let best = perUniversity.get(leadUniversity)!
      for (const [universityId, entry] of perUniversity) {
        const better =
          entry.stuck > best.stuck ||
          (entry.stuck === best.stuck && entry.total > best.total) ||
          (entry.stuck === best.stuck && entry.total === best.total && entry.first < best.first)
        if (better) {
          leadUniversity = universityId
          best = entry
        }
      }

      // Ведущая связка — первая требующая внимания у ведущего вуза, иначе первая его.
      const ofLead = list.filter((item) => item.universityId === leadUniversity)
      const lead = ofLead.find(isStuck) ?? ofLead[0]!
      const rest = list.filter((item) => item !== lead)
      const items = [lead, ...rest.filter(isStuck), ...rest.filter((item) => !isStuck(item))]

      return {
        stage,
        items,
        count: list.length,
        stuckCount: list.filter(isStuck).length,
        leadName: universityLabel(lead),
      }
    })
}

/** Подпись этапа в виде «счётчик»: «КубГТУ и ещё 11». */
export function countLabel(group: Pick<StageGroup, 'count' | 'leadName'>): string {
  return group.count > 1 ? `${group.leadName} и ещё ${group.count - 1}` : group.leadName
}

/** Число внутри точки: больше двух знаков точка не держит. */
export function countText(count: number): string {
  return count > 99 ? '99+' : String(count)
}

/**
 * Поперечник точки-счётчика, px. Одна связка — обычная точка 10 px; дальше
 * точка растёт медленно (по логарифму) и не больше 26 px: число читается,
 * а 30 связок не превращаются в пятно. И никогда не шире этапа — соседние
 * точки не касаются друг друга даже на телефоне.
 */
export function counterSize(count: number, stageWidth: number): number {
  const wanted = count <= 1 ? 10 : Math.min(26, Math.round(16 + 3 * Math.log2(count)))
  return Math.max(Math.min(wanted, Math.floor(stageWidth) - 5), count <= 1 ? 6 : 14)
}

/** Столбик: сколько точек рисуется и сколько уходит в «+N». */
export function columnSplit(count: number, max = COLUMN_MAX): { dots: number; more: number } {
  const dots = Math.min(count, max)
  return { dots, more: count - dots }
}

/** Середина этапа на шкале, px от левого края. */
export function stageCenter(stage: number, width: number): number {
  return ((stage - 0.5) / TOTAL_STAGES) * width
}

export interface Rect {
  left: number
  right: number
  top: number
  bottom: number
}

export interface LabelCandidate {
  key: number
  /** Центр подписи по горизонтали — середина этапа. */
  x: number
  /** Верх подписи. */
  top: number
  /** Варианты текста от полного к короткому: не влез полный — пробуется следующий. */
  texts: string[]
  /** Чем больше, тем раньше подпись получает место. */
  weight: number
}

export interface PlacedLabel {
  key: number
  text: string
  /** Левый край подписи, px. */
  left: number
  width: number
  top: number
}

const overlaps = (a: Rect, b: Rect) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom

/**
 * Раскладка подписей этапов без наложений.
 *
 * Подписи ставятся по важности: сначала этапы, где есть требующие внимания,
 * затем по числу связок. Подпись по центру этапа, у края шкалы — сдвинута
 * внутрь, за шкалу не выходит. Если полный текст налезает на уже поставленную
 * подпись или на препятствие (столбик соседнего этапа), пробуется короткий;
 * не влез и он — подписи нет: имя остаётся в `aria-label` точки и в списке.
 */
export function placeStageLabels(
  candidates: readonly LabelCandidate[],
  options: {
    width: number
    height: number
    measure: (text: string) => number
    gap?: number
    obstacles?: readonly Rect[]
  },
): PlacedLabel[] {
  const gap = options.gap ?? 8
  const taken: Rect[] = []
  const placed: PlacedLabel[] = []
  const order = [...candidates].sort((a, b) => b.weight - a.weight || a.key - b.key)

  for (const candidate of order) {
    for (const text of candidate.texts) {
      const width = Math.ceil(options.measure(text))
      if (width > options.width) continue
      const left = Math.min(Math.max(candidate.x - width / 2, 0), options.width - width)
      const rect = { left, right: left + width, top: candidate.top, bottom: candidate.top + options.height }
      const padded = { ...rect, left: rect.left - gap / 2, right: rect.right + gap / 2 }
      const blocked =
        taken.some((other) => overlaps(padded, other)) ||
        (options.obstacles ?? []).some((obstacle) => overlaps(padded, obstacle))
      if (blocked) continue
      taken.push(padded)
      placed.push({ key: candidate.key, text, left, width, top: candidate.top })
      break
    }
  }

  return placed.sort((a, b) => a.key - b.key)
}

/** Оценка ширины текста до замера шрифтом: 12 px, с запасом под кириллицу. */
export const estimateTextWidth = (text: string): number => text.length * 7.2

/** Вертикальная сетка маршрута, px (одна на оба вида: CSS получает её переменными). */
export const ROUTE_GEOMETRY = {
  /** Верх подписей. */
  labelTop: 4,
  labelHeight: 16,
  /** Точка связки. */
  dot: 10,
  /** Шаг точек в столбике: зазор 3 px — точки не касаются. */
  step: 13,
  /** Строка «+N» над столбиком. */
  moreHeight: 16,
} as const

export interface CounterMarker {
  view: 'count'
  size: number
}

export interface ColumnMarker {
  view: 'column'
  /** Точки снизу вверх: `y` — центр точки, px от верха дорожки. */
  dots: Array<{ item: CooperationListItemDto; y: number }>
  more: number
  /** Верх строки «+N», если она есть. */
  moreTop: number | null
}

export interface StageMarker {
  group: StageGroup
  x: number
  /** Насколько отметка поднимается над линией — от этой высоты открывается список. */
  rise: number
  marker: CounterMarker | ColumnMarker
}

export interface RouteLayout {
  /** Линия маршрута, px от верха дорожки. */
  lineY: number
  /** Сколько отметки опускаются ниже линии. */
  drop: number
  stages: StageMarker[]
  labels: PlacedLabel[]
}

/**
 * Вся раскладка маршрута по ширине дорожки: где линия, где отметки этапов,
 * какие подписи поместились. Высота дорожки подстраивается под самый высокий
 * столбик или самую крупную точку — ничего не вылезает над блоком.
 */
export function routeLayout(
  groups: readonly StageGroup[],
  view: RouteView,
  width: number,
  measure: (text: string) => number = estimateTextWidth,
): RouteLayout {
  const g = ROUTE_GEOMETRY
  const stageWidth = width / TOTAL_STAGES
  const labelBand = g.labelTop + g.labelHeight

  if (view === 'count') {
    const sizes = groups.map((group) => counterSize(group.count, stageWidth))
    const maxSize = Math.max(g.dot, ...sizes)
    const lineY = labelBand + 6 + maxSize / 2
    const stages = groups.map<StageMarker>((group, index) => ({
      group,
      x: stageCenter(group.stage, width),
      rise: sizes[index]! / 2,
      marker: { view: 'count', size: sizes[index]! },
    }))
    const labels = placeStageLabels(
      stages.map(({ group, x }) => ({
        key: group.stage,
        x,
        top: g.labelTop,
        texts: group.count > 1 ? [countLabel(group), group.leadName] : [group.leadName],
        weight: group.stuckCount * 1000 + group.count,
      })),
      { width, height: g.labelHeight, measure },
    )
    return { lineY, drop: maxSize / 2, stages, labels }
  }

  // Столбик: высота над линией у каждого этапа своя.
  const extents = groups.map((group) => {
    const { dots, more } = columnSplit(group.count)
    return (dots - 1) * g.step + g.dot / 2 + (more > 0 ? 2 + g.moreHeight : 0)
  })
  const lineY = labelBand + 4 + Math.max(g.dot / 2, ...extents)
  const stages = groups.map<StageMarker>((group, index) => {
    const { dots, more } = columnSplit(group.count)
    // Снизу вверх: ведущая связка (её вуз в подписи) — верхняя точка.
    const column = group.items.slice(0, dots).reverse()
    const topCenter = lineY - (dots - 1) * g.step
    return {
      group,
      x: stageCenter(group.stage, width),
      rise: extents[index]!,
      marker: {
        view: 'column',
        dots: column.map((item, k) => ({ item, y: lineY - k * g.step })),
        more,
        moreTop: more > 0 ? topCenter - g.dot / 2 - 2 - g.moreHeight : null,
      },
    }
  })
  const obstacles = stages.map(({ x, rise, marker }) => {
    // «+N» — кнопка с полями по 4 px: препятствие шире самого текста.
    const more = marker.view === 'column' && marker.more > 0 ? measure(`+${marker.more}`) + 8 : 0
    const half = Math.max(g.dot, more) / 2
    return { left: x - half, right: x + half, top: lineY - rise, bottom: lineY + g.dot / 2 }
  })
  const labels = placeStageLabels(
    stages.map(({ group, x, rise }) => ({
      key: group.stage,
      x,
      top: lineY - rise - 4 - g.labelHeight,
      texts: [group.leadName],
      weight: group.stuckCount * 1000 + group.count,
    })),
    { width, height: g.labelHeight, measure, obstacles },
  )
  return { lineY, drop: g.dot / 2, stages, labels }
}
