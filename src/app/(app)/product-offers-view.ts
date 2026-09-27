import type { ConfidenceLevel, ProductReachDto, ProductRecommendationDto } from '@/shared/contracts'
import type { MeasureBarRow, MeasureTone } from '@/ui/data/MeasureBars'

/**
 * Показ рекомендаций продуктов (решение 223): полосы балла, подписи уверенности,
 * цель новой связки. Расчёт — на сервере (`product-match.rules.ts`), здесь только
 * раскладка ответа.
 */

export const CONFIDENCE_WORDS: Record<ConfidenceLevel, string> = {
  HIGH: 'уверенность высокая',
  MEDIUM: 'уверенность средняя',
  LOW: 'мало данных',
}

const CONFIDENCE_TONE: Record<ConfidenceLevel, MeasureTone> = {
  HIGH: 'default',
  MEDIUM: 'default',
  LOW: 'warning',
}

/**
 * Полоса балла одного продукта. Мало данных — полоса приглушена и подпись жёлтым:
 * балл посчитан, но опираться на него рано. `withProgram` — в карточке вуза и общем
 * списке: под продуктом названа программа.
 */
export function offerRow(
  item: ProductRecommendationDto,
  options: { withProgram?: boolean; href?: string } = {},
): MeasureBarRow {
  return {
    key: `${item.program.id}:${item.product.id}`,
    label: item.product.name,
    ...(options.withProgram ? { caption: `${item.program.name} · ${item.program.universityName}` } : {}),
    ...(options.href ? { href: options.href } : {}),
    value: item.score,
    valueText: `${item.score} из 100`,
    tone: item.lowData ? 'muted' : 'default',
    note: CONFIDENCE_WORDS[item.confidence],
    noteTone: CONFIDENCE_TONE[item.confidence],
  }
}

/** Полосы «куда нести продукт»: длина — для скольких программ он лучший вариант. */
export function reachRows(reach: readonly ProductReachDto[]): MeasureBarRow[] {
  return reach
    .filter((row) => row.recommendedFor > 0)
    .map((row) => ({
      key: row.productId,
      label: row.productName,
      value: row.bestFor,
      valueText: row.bestFor === 0 ? 'нигде не первый' : `лучший для ${row.bestFor}`,
      tone: row.bestFor === 0 ? 'muted' : 'default',
      note:
        `рекомендуется ${row.recommendedFor}` + (row.averageScore === null ? '' : ` · средний балл ${row.averageScore}`),
    }))
}

/** Правый край шкалы «куда нести»: наибольшее число программ, но не меньше одной. */
export function reachMax(reach: readonly ProductReachDto[]): number {
  return Math.max(1, ...reach.map((row) => row.bestFor))
}

/**
 * Цель новой связки из рекомендации — чтобы в карточке связки было видно, зачем
 * её завели: «Закрыть дефициты программы: Kubernetes, Docker, Linux».
 */
export function cooperationGoal(item: ProductRecommendationDto): string {
  const names = item.closes.filter((skill) => !skill.outOfProfile).map((skill) => skill.name)
  const list = (names.length > 0 ? names : item.closes.map((skill) => skill.name)).slice(0, 5)
  return list.length > 0
    ? `Закрыть дефициты программы: ${list.join(', ')} (рекомендация продуктов, балл ${item.score})`
    : `Предложить продукт «${item.product.name}» (рекомендация продуктов, балл ${item.score})`
}

/**
 * Причины, одинаковые у всех показанных продуктов («у вуза уже идёт связка с…»),
 * — одной строкой над списком, а не трижды под каждым продуктом.
 */
export function splitCommonReasons(items: readonly ProductRecommendationDto[]): {
  common: string[]
  own: (item: ProductRecommendationDto) => string[]
} {
  if (items.length < 2) return { common: [], own: (item) => item.reasons }
  const [first, ...rest] = items
  const common = first!.reasons.filter((reason) => rest.every((item) => item.reasons.includes(reason)))
  return { common, own: (item) => item.reasons.filter((reason) => !common.includes(reason)) }
}
