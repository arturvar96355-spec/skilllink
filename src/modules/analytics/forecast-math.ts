/**
 * Математика прогноза (решение 132): логистическая регрессия с L2, метрики качества,
 * калибровка, PSI. Чистые функции без зависимостей — формулы в docs/FORECAST_MODEL.md.
 */

export function sigmoid(z: number): number {
  if (z >= 0) return 1 / (1 + Math.exp(-z))
  const e = Math.exp(z)
  return e / (1 + e)
}

export function logit(p: number): number {
  return Math.log(p / (1 - p))
}

/**
 * Решение системы A·x = b методом Гаусса с выбором главного элемента.
 * Матрица маленькая (признаков меньше двадцати), точности double хватает.
 */
export function solveLinear(a: readonly number[][], b: readonly number[]): number[] {
  const n = b.length
  const m = a.map((row, i) => [...row, b[i]!])
  for (let col = 0; col < n; col += 1) {
    let pivot = col
    for (let row = col + 1; row < n; row += 1) {
      if (Math.abs(m[row]![col]!) > Math.abs(m[pivot]![col]!)) pivot = row
    }
    if (Math.abs(m[pivot]![col]!) < 1e-12) throw new Error('Вырожденная система: признаки линейно зависимы')
    ;[m[col], m[pivot]] = [m[pivot]!, m[col]!]
    for (let row = col + 1; row < n; row += 1) {
      const factor = m[row]![col]! / m[col]![col]!
      for (let k = col; k <= n; k += 1) m[row]![k]! -= factor * m[col]![k]!
    }
  }
  const x = new Array<number>(n).fill(0)
  for (let row = n - 1; row >= 0; row -= 1) {
    let sum = m[row]![n]!
    for (let k = row + 1; k < n; k += 1) sum -= m[row]![k]! * x[k]!
    x[row] = sum / m[row]![row]!
  }
  return x
}

export interface LogisticFit {
  intercept: number
  weights: number[]
  iterations: number
  converged: boolean
  /** Штрафованная функция потерь в найденной точке: −Σ log-правдоподобия + λ/2·‖w‖². */
  loss: number
}

export interface LogisticOptions {
  lambda: number
  maxIterations: number
  tolerance: number
}

function penalizedLoss(x: readonly number[][], y: readonly number[], beta: readonly number[], lambda: number): number {
  let loss = 0
  for (let i = 0; i < x.length; i += 1) {
    let z = beta[0]!
    for (let j = 0; j < x[i]!.length; j += 1) z += beta[j + 1]! * x[i]![j]!
    // log(1 + e^z) − y·z без переполнения.
    loss += (z > 0 ? z + Math.log1p(Math.exp(-z)) : Math.log1p(Math.exp(z))) - y[i]! * z
  }
  for (let j = 1; j < beta.length; j += 1) loss += (lambda / 2) * beta[j]! ** 2
  return loss
}

/**
 * Логистическая регрессия с L2 методом Ньютона (IRLS).
 *
 * Шаг: β ← β + (XᵀWX + λI′)⁻¹ · (Xᵀ(y − p) − λI′β), где W = diag(p(1 − p)),
 * I′ — единичная матрица без свободного члена (его не штрафуем).
 * Если шаг увеличил потери, он делится пополам — так Ньютон не разойдётся
 * на почти разделимых данных. Признаки должны быть уже стандартизованы.
 */
export function fitLogisticNewton(
  x: readonly number[][],
  y: readonly number[],
  options: LogisticOptions,
): LogisticFit {
  const p = (x[0]?.length ?? 0) + 1
  let beta = new Array<number>(p).fill(0)
  let loss = penalizedLoss(x, y, beta, options.lambda)
  let converged = false
  let iterations = 0

  for (; iterations < options.maxIterations && !converged; iterations += 1) {
    const hessian = Array.from({ length: p }, () => new Array<number>(p).fill(0))
    const gradient = new Array<number>(p).fill(0)
    for (let i = 0; i < x.length; i += 1) {
      const row = [1, ...x[i]!]
      let z = 0
      for (let j = 0; j < p; j += 1) z += beta[j]! * row[j]!
      const prob = sigmoid(z)
      const w = Math.max(prob * (1 - prob), 1e-10)
      for (let j = 0; j < p; j += 1) {
        gradient[j]! += (y[i]! - prob) * row[j]!
        for (let k = j; k < p; k += 1) hessian[j]![k]! += w * row[j]! * row[k]!
      }
    }
    for (let j = 0; j < p; j += 1) {
      for (let k = 0; k < j; k += 1) hessian[j]![k] = hessian[k]![j]!
      if (j > 0) {
        hessian[j]![j]! += options.lambda
        gradient[j]! -= options.lambda * beta[j]!
      }
    }
    // Без штрафа у свободного члена и у признака-константы гессиан может выродиться — крошечная добавка.
    hessian[0]![0]! += 1e-9

    const delta = solveLinear(hessian, gradient)
    let step = 1
    let candidate = beta.map((value, j) => value + delta[j]!)
    let candidateLoss = penalizedLoss(x, y, candidate, options.lambda)
    while (candidateLoss > loss + 1e-12 && step > 1e-6) {
      step /= 2
      candidate = beta.map((value, j) => value + step * delta[j]!)
      candidateLoss = penalizedLoss(x, y, candidate, options.lambda)
    }
    const change = Math.max(...delta.map((value) => Math.abs(step * value)))
    beta = candidate
    loss = candidateLoss
    if (change < options.tolerance) converged = true
  }

  return { intercept: beta[0]!, weights: beta.slice(1), iterations, converged, loss }
}

/**
 * Та же задача градиентным спуском — медленно, но без обращения матриц.
 * Нужна тестам: два независимых метода обязаны прийти в одну точку.
 */
export function fitLogisticGradient(
  x: readonly number[][],
  y: readonly number[],
  options: { lambda: number; learningRate: number; iterations: number },
): LogisticFit {
  const p = (x[0]?.length ?? 0) + 1
  const beta = new Array<number>(p).fill(0)
  const n = Math.max(x.length, 1)
  for (let iteration = 0; iteration < options.iterations; iteration += 1) {
    const gradient = new Array<number>(p).fill(0)
    for (let i = 0; i < x.length; i += 1) {
      const row = [1, ...x[i]!]
      let z = 0
      for (let j = 0; j < p; j += 1) z += beta[j]! * row[j]!
      const residual = sigmoid(z) - y[i]!
      for (let j = 0; j < p; j += 1) gradient[j]! += residual * row[j]!
    }
    for (let j = 1; j < p; j += 1) gradient[j]! += options.lambda * beta[j]!
    for (let j = 0; j < p; j += 1) beta[j]! -= (options.learningRate / n) * gradient[j]!
  }
  return {
    intercept: beta[0]!,
    weights: beta.slice(1),
    iterations: options.iterations,
    converged: true,
    loss: penalizedLoss(x, y, beta, options.lambda),
  }
}

export interface Standardizer {
  mean: number[]
  std: number[]
}

/** Среднее и стандартное отклонение по столбцам. Постоянный признак получает std = 0. */
export function fitStandardizer(x: readonly number[][]): Standardizer {
  const p = x[0]?.length ?? 0
  const n = x.length
  const mean = new Array<number>(p).fill(0)
  const std = new Array<number>(p).fill(0)
  if (n === 0) return { mean, std }
  for (const row of x) for (let j = 0; j < p; j += 1) mean[j]! += row[j]! / n
  for (const row of x) for (let j = 0; j < p; j += 1) std[j]! += (row[j]! - mean[j]!) ** 2 / n
  for (let j = 0; j < p; j += 1) std[j] = Math.sqrt(std[j]!)
  return { mean, std }
}

/** z = (x − среднее) / σ; у постоянного признака z = 0: он ничего не различает. */
export function standardize(row: readonly number[], scaler: Standardizer): number[] {
  return row.map((value, j) => (scaler.std[j]! > 1e-12 ? (value - scaler.mean[j]!) / scaler.std[j]! : 0))
}

/**
 * Площадь под ROC-кривой через ранги (статистика Манна — Уитни):
 * AUC = (R₊ − n₊(n₊ + 1)/2) / (n₊·n₋), R₊ — сумма рангов положительных.
 * Одинаковым оценкам — средний ранг: ничья между положительным и отрицательным
 * засчитывается как половина. null — если нет одного из классов.
 */
export function auc(scores: readonly number[], labels: readonly number[]): number | null {
  const n = scores.length
  const positives = labels.filter((label) => label === 1).length
  const negatives = n - positives
  if (positives === 0 || negatives === 0) return null

  const order = scores.map((score, index) => ({ score, index })).sort((a, b) => a.score - b.score)
  const ranks = new Array<number>(n)
  for (let i = 0; i < n; ) {
    let j = i
    while (j + 1 < n && order[j + 1]!.score === order[i]!.score) j += 1
    const averageRank = (i + j + 2) / 2 // ранги с единицы
    for (let k = i; k <= j; k += 1) ranks[order[k]!.index] = averageRank
    i = j + 1
  }
  let positiveRankSum = 0
  for (let i = 0; i < n; i += 1) if (labels[i] === 1) positiveRankSum += ranks[i]!
  return (positiveRankSum - (positives * (positives + 1)) / 2) / (positives * negatives)
}

/**
 * Нижняя граница 95% интервала AUC по Хэнли и Макнилу (1982).
 * Снимки одной связки зависимы, поэтому граница оптимистична — это честно сказано в документе.
 */
export function aucLowerBound(value: number, positives: number, negatives: number): number {
  const q1 = value / (2 - value)
  const q2 = (2 * value * value) / (1 + value)
  const variance =
    (value * (1 - value) + (positives - 1) * (q1 - value * value) + (negatives - 1) * (q2 - value * value)) /
    (positives * negatives)
  return value - 1.96 * Math.sqrt(Math.max(variance, 0))
}

/** Brier score — средний квадрат ошибки вероятности: 0 — идеально, 0,25 — «всегда 50%». */
export function brier(probabilities: readonly number[], labels: readonly number[]): number | null {
  if (probabilities.length === 0) return null
  let sum = 0
  for (let i = 0; i < probabilities.length; i += 1) sum += (probabilities[i]! - labels[i]!) ** 2
  return sum / probabilities.length
}

export interface CalibrationBin {
  from: number
  to: number
  count: number
  /** Средняя предсказанная вероятность в корзине; null — корзина пуста. */
  meanPredicted: number | null
  /** Доля дошедших до вехи на самом деле; null — корзина пуста. */
  observedRate: number | null
}

/** Калибровка: вероятности режутся на корзины равной ширины [0; 0,2), [0,2; 0,4) … [0,8; 1]. */
export function calibration(
  probabilities: readonly number[],
  labels: readonly number[],
  bins: number,
): CalibrationBin[] {
  const result: CalibrationBin[] = []
  for (let b = 0; b < bins; b += 1) {
    const from = b / bins
    const to = (b + 1) / bins
    let count = 0
    let predicted = 0
    let observed = 0
    for (let i = 0; i < probabilities.length; i += 1) {
      const p = probabilities[i]!
      const inBin = b === bins - 1 ? p >= from && p <= to : p >= from && p < to
      if (!inBin) continue
      count += 1
      predicted += p
      observed += labels[i]!
    }
    result.push({
      from,
      to,
      count,
      meanPredicted: count > 0 ? predicted / count : null,
      observedRate: count > 0 ? observed / count : null,
    })
  }
  return result
}

/** Квантиль отсортированного массива с линейной интерполяцией. */
export function quantileSorted(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0
  const position = (sorted.length - 1) * q
  const lower = Math.floor(position)
  const upper = Math.ceil(position)
  return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (position - lower)
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null
  return quantileSorted([...values].sort((a, b) => a - b), 0.5)
}

export interface PsiBins {
  /** Внутренние границы корзин по возрастанию, без повторов. */
  edges: number[]
  /** Доля обучающих значений в каждой корзине (edges.length + 1 корзин). */
  expected: number[]
}

/** Номер корзины: сколько границ строго меньше значения (значение на границе — в левую корзину). */
export function binIndex(value: number, edges: readonly number[]): number {
  let index = 0
  while (index < edges.length && value > edges[index]!) index += 1
  return index
}

/**
 * Корзины для PSI по децилям обучающей выборки. У дискретного признака децили
 * совпадают — повторы убираются, корзин становится меньше десяти.
 */
export function psiBins(values: readonly number[], bins: number): PsiBins {
  const sorted = [...values].sort((a, b) => a - b)
  const edges: number[] = []
  for (let b = 1; b < bins; b += 1) {
    const edge = quantileSorted(sorted, b / bins)
    if (edges.length === 0 || edge > edges[edges.length - 1]!) edges.push(edge)
  }
  return { edges, expected: shares(values, edges) }
}

function shares(values: readonly number[], edges: readonly number[]): number[] {
  const counts = new Array<number>(edges.length + 1).fill(0)
  for (const value of values) counts[binIndex(value, edges)]! += 1
  return counts.map((count) => (values.length > 0 ? count / values.length : 0))
}

/**
 * Population Stability Index: PSI = Σ (a − e)·ln(a / e) по корзинам обучающей выборки,
 * a — доля текущих значений, e — обучающих. Пустая доля заменяется на 0,0001,
 * иначе логарифм уходит в бесконечность от одной пустой корзины.
 * Ориентиры: < 0,1 — сдвига нет, 0,1–0,25 — умеренный, > 0,25 — сильный.
 */
export function psi(bins: PsiBins, current: readonly number[]): number {
  const actual = shares(current, bins.edges)
  const floor = 1e-4
  let sum = 0
  for (let b = 0; b < actual.length; b += 1) {
    const a = Math.max(actual[b]!, floor)
    const e = Math.max(bins.expected[b] ?? 0, floor)
    sum += (a - e) * Math.log(a / e)
  }
  return sum
}

/** Доля значений выборки (по сохранённым квантилям) строго меньше и строго больше данного. */
export function shareBelowAbove(quantiles: readonly number[], value: number): { below: number; above: number } {
  if (quantiles.length === 0) return { below: 0, above: 0 }
  const below = quantiles.filter((q) => q < value).length / quantiles.length
  const above = quantiles.filter((q) => q > value).length / quantiles.length
  return { below, above }
}

/**
 * Детерминированный генератор псевдослучайных чисел (mulberry32).
 * Нужен синтетике тестов: одно зерно — одна и та же история на любой машине.
 */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
