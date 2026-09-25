/**
 * «Система заметила» — детектор отклонений без ИИ (решение 120, docs/ANALYTICS_MODEL.md).
 * Чистый модуль: на вход — ряд счётчиков по полным периодам, на выход — есть ли
 * отклонение и насколько. Его же использует генератор демо-данных (решение 121),
 * чтобы подогнать размер заложенного выброса: пороги — экспортируемые константы.
 *
 * Правило (дневной ряд):
 *   recent — последние 7 полных дней, base — 28 полных дней ПЕРЕД ними (окна не
 *   пересекаются, всего 35 дней; текущий неполный день в ряд не входит);
 *   mean7, mean28 — средние; sd28 — выборочное стандартное отклонение base (n − 1);
 *   z = (mean7 − mean28) / max(sd28, 0,01·mean28, 1);
 *   отклонение, если |z| > 2 и |mean7 / mean28 − 1| ≥ 15%.
 * Нижняя граница знаменателя: при sd = 0 (ровный фон) любое движение дало бы
 * бесконечный z; «1» — одно событие в день, меньше не имеет смысла для счётчиков.
 * Если mean28 = 0, относительное изменение считается бесконечным при mean7 > 0.
 * Меньше 35 полных дней истории — `insufficient_data`, отклонений не ищем.
 */

export interface AnomalyOptions {
  /** Длина «последнего» окна в периодах. */
  recent: number
  /** Длина фонового окна в периодах — сразу перед последним. */
  base: number
  /** Минимум полных периодов истории. */
  minPoints: number
  /** Порог |z|. Строго больше. */
  zThreshold: number
  /** Порог относительного изменения |mean_recent / mean_base − 1|. Не меньше. */
  minRelativeChange: number
  /** Нижняя граница знаменателя как доля фонового среднего. */
  sdFloorShare: number
  /** Нижняя граница знаменателя в штуках. */
  sdFloorAbsolute: number
}

/** Дневной ряд: 7 против 28, нужно 35 полных дней. */
export const ANOMALY_DAILY: Readonly<AnomalyOptions> = Object.freeze({
  recent: 7,
  base: 28,
  minPoints: 35,
  zThreshold: 2,
  minRelativeChange: 0.15,
  sdFloorShare: 0.01,
  sdFloorAbsolute: 1,
})

/**
 * Недельный ряд: 4 недели против 12 предыдущих (месяц против квартала), нужно 16
 * полных недель; текущая неделя не входит. Пороги те же.
 */
export const ANOMALY_WEEKLY: Readonly<AnomalyOptions> = Object.freeze({
  recent: 4,
  base: 12,
  minPoints: 16,
  zThreshold: 2,
  minRelativeChange: 0.15,
  sdFloorShare: 0.01,
  sdFloorAbsolute: 1,
})

export interface AnomalyResult {
  status: 'ok' | 'insufficient_data'
  isAnomaly: boolean
  /** null — данных мало. */
  z: number | null
  meanRecent: number | null
  meanBase: number | null
  sdBase: number | null
  /** Знаменатель z после нижних границ. */
  scale: number | null
  /** mean_recent / mean_base − 1; Infinity — фон нулевой, а сейчас не ноль. */
  relativeChange: number | null
  direction: 'up' | 'down' | 'flat' | null
  /** Сколько полных периодов было в ряду. */
  points: number
}

const mean = (values: readonly number[]): number =>
  values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length

/** Выборочное стандартное отклонение (делитель n − 1); для одного значения — 0. */
export function sampleSd(values: readonly number[]): number {
  if (values.length < 2) return 0
  const average = mean(values)
  const squares = values.reduce((sum, value) => sum + (value - average) ** 2, 0)
  return Math.sqrt(squares / (values.length - 1))
}

/**
 * Проверка ряда. `series` — счётчики по ПОЛНЫМ периодам от старых к новым; текущий
 * неполный период вызывающий отрезает сам (`dailyCounts` и `weeklyCounts` это делают).
 */
export function detectAnomaly(
  series: readonly number[],
  options: Readonly<AnomalyOptions> = ANOMALY_DAILY,
): AnomalyResult {
  const needed = Math.max(options.minPoints, options.recent + options.base)
  if (series.length < needed) {
    return {
      status: 'insufficient_data',
      isAnomaly: false,
      z: null,
      meanRecent: null,
      meanBase: null,
      sdBase: null,
      scale: null,
      relativeChange: null,
      direction: null,
      points: series.length,
    }
  }
  const recent = series.slice(-options.recent)
  const base = series.slice(-(options.recent + options.base), -options.recent)
  const meanRecent = mean(recent)
  const meanBase = mean(base)
  const sdBase = sampleSd(base)
  const scale = Math.max(sdBase, options.sdFloorShare * meanBase, options.sdFloorAbsolute)
  const z = (meanRecent - meanBase) / scale
  const relativeChange =
    meanBase === 0 ? (meanRecent === 0 ? 0 : Number.POSITIVE_INFINITY) : meanRecent / meanBase - 1
  const isAnomaly =
    Math.abs(z) > options.zThreshold && Math.abs(relativeChange) >= options.minRelativeChange
  return {
    status: 'ok',
    isAnomaly,
    z,
    meanRecent,
    meanBase,
    sdBase,
    scale,
    relativeChange,
    direction: meanRecent > meanBase ? 'up' : meanRecent < meanBase ? 'down' : 'flat',
    points: series.length,
  }
}

/** Короткая форма для генератора демо-данных и тестов. */
export function isAnomaly(series: readonly number[], options: Readonly<AnomalyOptions> = ANOMALY_DAILY): boolean {
  return detectAnomaly(series, options).isAnomaly
}

// ─────────────────────────── Ряды из дат событий ────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000
/** Сутки — московские, как везде в системе (`src/shared/utils/date.ts`). */
const MOSCOW_OFFSET_MS = 3 * 60 * 60 * 1000

/** Номер московских суток. */
export function moscowDayIndex(date: Date): number {
  return Math.floor((date.getTime() + MOSCOW_OFFSET_MS) / DAY_MS)
}

/** Номер московской недели (с понедельника). День 0 эпохи — четверг. */
export function moscowWeekIndex(date: Date): number {
  return Math.floor((moscowDayIndex(date) + 3) / 7)
}

/**
 * Счётчики по полным московским суткам от `historyStart` до вчера включительно.
 * Сегодняшние (неполные) сутки не входят. События раньше начала истории
 * отбрасываются, будущие — тоже.
 */
export function dailyCounts(dates: readonly Date[], historyStart: Date, now: Date): number[] {
  const first = moscowDayIndex(historyStart)
  const today = moscowDayIndex(now)
  const length = Math.max(0, today - first)
  const counts = new Array<number>(length).fill(0)
  for (const date of dates) {
    const index = moscowDayIndex(date) - first
    if (index >= 0 && index < length) counts[index]! += 1
  }
  return counts
}

/**
 * Счётчики по полным неделям (пн–вс). Неделя, в которой началась история, входит,
 * только если история началась в её понедельник; текущая неделя не входит.
 */
export function weeklyCounts(dates: readonly Date[], historyStart: Date, now: Date): number[] {
  const startDay = moscowDayIndex(historyStart)
  const startWeek = moscowWeekIndex(historyStart) + ((startDay + 3) % 7 === 0 ? 0 : 1)
  const currentWeek = moscowWeekIndex(now)
  const length = Math.max(0, currentWeek - startWeek)
  const counts = new Array<number>(length).fill(0)
  for (const date of dates) {
    const index = moscowWeekIndex(date) - startWeek
    if (index >= 0 && index < length) counts[index]! += 1
  }
  return counts
}

// ─────────────────────────── Разложение изменения ───────────────────────────

/**
 * Разложение изменения T = A × I (например, «переходы этапов = активные вузы ×
 * переходов на вуз») на вклад количества и вклад интенсивности — без остатка.
 *
 * Берётся симметричная (шепли) форма для двух множителей:
 *   ΔA-вклад = (A₁ − A₀)·(I₀ + I₁)/2,   ΔI-вклад = (I₁ − I₀)·(A₀ + A₁)/2;
 *   сумма = A₁I₁ − A₀I₀ = T₁ − T₀ ровно (раскройте скобки).
 * В отличие от логарифмической формы работает и с нулями: вузов не было — стало.
 * I при A = 0 — 0 (событий нет).
 */
export interface Decomposition {
  totalBase: number
  totalRecent: number
  change: number
  countBase: number
  countRecent: number
  intensityBase: number
  intensityRecent: number
  /** Вклад изменения количества (A). */
  countEffect: number
  /** Вклад изменения интенсивности (I). */
  intensityEffect: number
}

export function decomposeChange(input: {
  totalBase: number
  totalRecent: number
  countBase: number
  countRecent: number
}): Decomposition {
  const intensityBase = input.countBase > 0 ? input.totalBase / input.countBase : 0
  const intensityRecent = input.countRecent > 0 ? input.totalRecent / input.countRecent : 0
  // Когда A = 0, а T ≠ 0 (события без вуза), произведение A·I не равно T. Чтобы сумма
  // вкладов всё равно была ровно ΔT, разница уходит во вклад интенсивности.
  const product = (count: number, intensity: number) => count * intensity
  const countEffect = ((input.countRecent - input.countBase) * (intensityBase + intensityRecent)) / 2
  const change = input.totalRecent - input.totalBase
  const modelChange = product(input.countRecent, intensityRecent) - product(input.countBase, intensityBase)
  const intensityEffect =
    ((intensityRecent - intensityBase) * (input.countBase + input.countRecent)) / 2 + (change - modelChange)
  return {
    totalBase: input.totalBase,
    totalRecent: input.totalRecent,
    change,
    countBase: input.countBase,
    countRecent: input.countRecent,
    intensityBase,
    intensityRecent,
    countEffect,
    intensityEffect,
  }
}

export interface Contribution {
  key: string
  base: number
  recent: number
  /** recent − base: сумма по всем разрезам равна общему изменению. */
  delta: number
  /** delta / общее изменение; null, если общее изменение 0. */
  share: number | null
}

/**
 * Вклады разрезов (вузов) в изменение: по каждому — его разница, сумма разниц
 * ровно равна общему изменению. Отсортированы по модулю вклада.
 */
export function contributions(
  base: ReadonlyMap<string, number>,
  recent: ReadonlyMap<string, number>,
): Contribution[] {
  const keys = new Set([...base.keys(), ...recent.keys()])
  let total = 0
  const rows: Contribution[] = []
  for (const key of keys) {
    const b = base.get(key) ?? 0
    const r = recent.get(key) ?? 0
    total += r - b
    rows.push({ key, base: b, recent: r, delta: r - b, share: null })
  }
  for (const row of rows) row.share = total === 0 ? null : row.delta / total
  return rows.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.key.localeCompare(b.key))
}

/**
 * Сколько первых разрезов (того же знака, что общее изменение) объясняют не меньше
 * `coverage` изменения: «падение на 60% объясняется двумя вузами».
 */
export function explainingSlices(rows: readonly Contribution[], coverage = 0.5): Contribution[] {
  const total = rows.reduce((sum, row) => sum + row.delta, 0)
  if (total === 0) return []
  const picked: Contribution[] = []
  let covered = 0
  for (const row of rows) {
    if (Math.sign(row.delta) !== Math.sign(total)) continue
    picked.push(row)
    covered += row.delta
    if (covered / total >= coverage) break
  }
  return picked
}
