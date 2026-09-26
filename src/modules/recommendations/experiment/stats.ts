/**
 * Статистика проверки рекомендаций (решение 136). Без зависимостей: квантили
 * нормального распределения и распределения Стьюдента считаются здесь же.
 *
 * Формулы и почему выбраны именно они — docs/RECOMMENDATIONS_EXPERIMENT.md.
 */

export interface Interval {
  low: number
  high: number
}

// ─────────────────────────── Квантили ────────────────────────────────────────

/**
 * Квантиль стандартного нормального распределения — алгоритм Акклама
 * (относительная ошибка до 1,15·10⁻⁹): Φ⁻¹(0,975) = 1,959964.
 */
export function normalQuantile(p: number): number {
  if (!(p > 0 && p < 1)) throw new RangeError('Вероятность должна быть строго между 0 и 1')
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239]
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1]
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783]
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416]
  const low = 0.02425
  if (p < low) {
    const q = Math.sqrt(-2 * Math.log(p))
    return (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
      ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1)
  }
  if (p > 1 - low) return -normalQuantile(1 - p)
  const q = p - 0.5
  const r = q * q
  return ((((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q) /
    (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1)
}

/** ln Γ(x) — приближение Ланцоша (g = 7), точность ~15 знаков. */
function logGamma(x: number): number {
  const g = 7
  const coef = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
    1.5056327351493116e-7,
  ]
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x)
  const z = x - 1
  let sum = coef[0]!
  for (let i = 1; i < g + 2; i += 1) sum += coef[i]! / (z + i)
  const t = z + g + 0.5
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(sum)
}

/** Непрерывная дробь неполной бета-функции (метод Лентца). */
function betaContinuedFraction(a: number, b: number, x: number): number {
  const tiny = 1e-300
  let c = 1
  let d = 1 - ((a + b) * x) / (a + 1)
  if (Math.abs(d) < tiny) d = tiny
  d = 1 / d
  let h = d
  for (let m = 1; m <= 300; m += 1) {
    const m2 = 2 * m
    let aa = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2))
    d = 1 + aa * d
    if (Math.abs(d) < tiny) d = tiny
    c = 1 + aa / c
    if (Math.abs(c) < tiny) c = tiny
    d = 1 / d
    h *= d * c
    aa = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1))
    d = 1 + aa * d
    if (Math.abs(d) < tiny) d = tiny
    c = 1 + aa / c
    if (Math.abs(c) < tiny) c = tiny
    d = 1 / d
    const delta = d * c
    h *= delta
    if (Math.abs(delta - 1) < 1e-14) break
  }
  return h
}

/** Регуляризованная неполная бета-функция I_x(a, b). */
export function regularizedBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0
  if (x >= 1) return 1
  const front = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x))
  if (x < (a + 1) / (a + b + 2)) return (front * betaContinuedFraction(a, b, x)) / a
  return 1 - (front * betaContinuedFraction(b, a, 1 - x)) / b
}

/** Функция распределения Стьюдента с df степенями свободы (df может быть дробным). */
export function studentCdf(t: number, df: number): number {
  const tail = 0.5 * regularizedBeta(df / (df + t * t), df / 2, 0.5)
  return t >= 0 ? 1 - tail : tail
}

/** Квантиль распределения Стьюдента — делением отрезка пополам по функции распределения. */
export function studentQuantile(p: number, df: number): number {
  if (!(p > 0 && p < 1)) throw new RangeError('Вероятность должна быть строго между 0 и 1')
  if (!(df > 0)) throw new RangeError('Число степеней свободы должно быть положительным')
  if (p === 0.5) return 0
  if (p < 0.5) return -studentQuantile(1 - p, df)
  let low = 0
  let high = 1
  while (studentCdf(high, df) < p) high *= 2
  for (let i = 0; i < 200; i += 1) {
    const mid = (low + high) / 2
    if (studentCdf(mid, df) < p) low = mid
    else high = mid
    if (high - low < 1e-12) break
  }
  return (low + high) / 2
}

// ─────────────────────────── Доли ────────────────────────────────────────────

/**
 * Интервал Уилсона для доли successes / n. В отличие от «p ± z·√(p(1−p)/n)» не вылезает
 * за 0…1 и не схлопывается в точку при 0 и 100 %: 0 из 20 — это «от 0 до 16 %»,
 * а не «ровно 0». n = 0 — данных нет, интервал весь отрезок 0…1.
 */
export function wilsonInterval(successes: number, n: number, z: number): Interval {
  if (n === 0) return { low: 0, high: 1 }
  const p = successes / n
  const z2 = z * z
  const denominator = 1 + z2 / n
  const center = (p + z2 / (2 * n)) / denominator
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denominator
  // Крайние случаи точно: при 0 и 100 % граница совпадает с краем, а не отстоит на 1e-17.
  return {
    low: successes === 0 ? 0 : Math.max(0, center - half),
    high: successes === n ? 1 : Math.min(1, center + half),
  }
}

/**
 * Интервал для разности долей p₁ − p₂ — метод 10 Ньюкомба (1998): гибрид
 * интервалов Уилсона каждой доли, без поправки на непрерывность.
 *
 *   L = d − √((p₁ − l₁)² + (u₂ − p₂)²),  U = d + √((u₁ − p₁)² + (p₂ − l₂)²)
 *
 * Держит заявленное покрытие при малых n и долях у краёв, где нормальное
 * приближение (метод Вальда) даёт слишком узкий интервал или нулевую ширину.
 */
export function newcombeDifference(
  successes1: number,
  n1: number,
  successes2: number,
  n2: number,
  z: number,
): Interval {
  const p1 = n1 === 0 ? 0 : successes1 / n1
  const p2 = n2 === 0 ? 0 : successes2 / n2
  const w1 = wilsonInterval(successes1, n1, z)
  const w2 = wilsonInterval(successes2, n2, z)
  const d = p1 - p2
  return {
    low: Math.max(-1, d - Math.sqrt((p1 - w1.low) ** 2 + (w2.high - p2) ** 2)),
    high: Math.min(1, d + Math.sqrt((w1.high - p1) ** 2 + (p2 - w2.low) ** 2)),
  }
}

// ─────────────────────────── Средние (Уэлч) ──────────────────────────────────

/** Сводка выборки без самих значений: число, сумма и сумма квадратов. */
export interface Moments {
  n: number
  sum: number
  sumSquares: number
}

export function momentsOf(values: readonly number[]): Moments {
  let sum = 0
  let sumSquares = 0
  for (const value of values) {
    sum += value
    sumSquares += value * value
  }
  return { n: values.length, sum, sumSquares }
}

/** Несмещённая дисперсия по сумме и сумме квадратов. */
export function varianceOf(moments: Moments): number {
  if (moments.n < 2) return Number.NaN
  const mean = moments.sum / moments.n
  // Разность больших чисел может уйти чуть ниже нуля от округления.
  return Math.max(0, (moments.sumSquares - moments.n * mean * mean) / (moments.n - 1))
}

export interface WelchResult {
  meanA: number
  meanB: number
  diff: number
  ci: Interval
  /** Степени свободы по Уэлчу — Саттертуэйту. */
  df: number
}

/**
 * Интервал Уэлча для разности средних (A − B) — дисперсии групп не считаются равными.
 *
 *   se² = s²_A/n_A + s²_B/n_B,  df = se⁴ / ((s²_A/n_A)²/(n_A−1) + (s²_B/n_B)²/(n_B−1))
 *   diff ± t(1 − α/2, df) · se
 *
 * null — в какой-то группе меньше двух значений: дисперсию не оценить.
 * Если обе дисперсии нулевые, интервал — точка.
 */
export function welchInterval(a: Moments, b: Moments, level: number): WelchResult | null {
  if (a.n < 2 || b.n < 2) return null
  const meanA = a.sum / a.n
  const meanB = b.sum / b.n
  const va = varianceOf(a) / a.n
  const vb = varianceOf(b) / b.n
  const se = Math.sqrt(va + vb)
  const diff = meanA - meanB
  if (se === 0) return { meanA, meanB, diff, ci: { low: diff, high: diff }, df: a.n + b.n - 2 }
  const df = (va + vb) ** 2 / (va ** 2 / (a.n - 1) + vb ** 2 / (b.n - 1))
  const t = studentQuantile(1 - (1 - level) / 2, df)
  return { meanA, meanB, diff, ci: { low: diff - t * se, high: diff + t * se }, df }
}

// ─────────────────────────── Последовательная проверка ───────────────────────

export type SequentialDecision = 'lift' | 'no-lift' | 'continue'

export interface SequentialResult {
  /** Логарифм отношения правдоподобия после последнего исхода. */
  llr: number
  /** Пересёк верхний порог — прирост есть. */
  upper: number
  /** Пересёк нижний порог — прироста нужного размера нет. */
  lower: number
  decision: SequentialDecision
  /** Сколько успехов просмотрено к моменту решения (или всего, если решения нет). */
  conversions: number
}

/**
 * Последовательная проверка Вальда (SPRT) по успехам в порядке их наступления.
 *
 * При доле контроля c и отсутствии эффекта успех приходит из группы treatment
 * с вероятностью q₀ = 1 − c (групп ровно в такой пропорции). Если рекомендация
 * повышает конверсию в (1 + r) раз, q₁ = (1 − c)(1 + r) / ((1 − c)(1 + r) + c).
 * Каждый успех добавляет ln(q₁/q₀) из treatment и ln((1 − q₁)/(1 − q₀)) из контроля.
 *
 * Пороги Вальда: A = ln((1 − β)/α) — «прирост есть», B = ln(β/(1 − α)) — «прироста
 * нет»; при α = 0,05 и β = 0,2 это 2,77 и −1,56. Проверку можно смотреть после
 * каждого нового исхода, не раздувая ошибку: в этом её смысл. Приближение —
 * пуассоновское (исходы редкие и независимые); итоговый вывод всё равно делает
 * интервал Ньюкомба, проверка лишь говорит, можно ли остановиться раньше.
 */
export function sequentialTest(
  successArms: ReadonlyArray<'treatment' | 'control'>,
  options: { controlShare: number; relativeLift: number; alpha: number; beta: number },
): SequentialResult {
  const { controlShare: c, relativeLift: r, alpha, beta } = options
  const upper = Math.log((1 - beta) / alpha)
  const lower = Math.log(beta / (1 - alpha))
  const q0 = 1 - c
  const q1 = ((1 - c) * (1 + r)) / ((1 - c) * (1 + r) + c)
  const fromTreatment = Math.log(q1 / q0)
  const fromControl = Math.log((1 - q1) / (1 - q0))

  let llr = 0
  let seen = 0
  if (c <= 0 || c >= 1) return { llr, upper, lower, decision: 'continue', conversions: 0 }
  for (const arm of successArms) {
    seen += 1
    llr += arm === 'treatment' ? fromTreatment : fromControl
    if (llr >= upper) return { llr, upper, lower, decision: 'lift', conversions: seen }
    if (llr <= lower) return { llr, upper, lower, decision: 'no-lift', conversions: seen }
  }
  return { llr, upper, lower, decision: 'continue', conversions: seen }
}
