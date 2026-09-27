/**
 * Числа для одной полосы `GapBars` (решение 197).
 *
 * Спрос и покрытие приходят из `SkillGapDto` в одной и той же шкале 0..1
 * (`docs/ANALYTICS_METHODOLOGY.md`, раздел 3): `coverage` — не доля от спроса,
 * а абсолютное значение на той же шкале, что и `demand`. Раньше полоса покрытия
 * считалась как `demand * coverage` — произведение двух долей 0..1 вместо
 * их разности, поэтому покрытая часть отображалась заметно меньше настоящей:
 * навык со спросом 0,73 и покрытием 0,67 (дефицит всего 0,06) закрашивался
 * так, будто покрыто только 0,67 × 0,73 ≈ 0,49, — треть полосы выглядела
 * незакрытой при почти закрытом на деле навыке.
 */
export interface GapBarMetrics {
  /** Спрос рынка, 0..100 — длина всей полосы. */
  demandPercent: number
  /** Дефицит, 0..100 — то, что не покрыто программами. Значение справа от полосы. */
  gapPercent: number
  /** Какую долю полосы (0..100 от `demandPercent`) закрасить бирюзой. */
  coveredShareOfBar: number
}

const clampShare = (value: number): number => Math.max(0, Math.min(value, 1))

/**
 * `demand` и `coverage` — доли 0..1 (`SkillGapDto.demandNormalized`, `.coverage`).
 * Покрытие сверх спроса не расширяет полосу — это запас, а не отрицательный
 * дефицит (`docs/ANALYTICS_METHODOLOGY.md`, раздел 3, «Размер дефицита»).
 */
export function gapBarMetrics(demand: number, coverage: number): GapBarMetrics {
  const demandPercent = clampShare(demand) * 100
  const coveragePercent = clampShare(coverage) * 100
  const coveredWithinDemand = Math.min(coveragePercent, demandPercent)
  const gapPercent = Math.max(0, demandPercent - coveragePercent)
  const coveredShareOfBar = demandPercent > 0 ? (coveredWithinDemand / demandPercent) * 100 : 0
  return { demandPercent, gapPercent, coveredShareOfBar }
}
