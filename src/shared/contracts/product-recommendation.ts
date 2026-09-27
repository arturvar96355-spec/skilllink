import type { ConfidenceLevel, ProductSkillRelevance, SkillLevel } from './enums'

/**
 * Рекомендации продуктов (решение 223): какой IT-продукт ИТ-Школы предложить
 * какой программе вуза и почему. Не путать со «Списком задач» (решение 212):
 * там правила «что сделать», здесь — подбор «что предложить» по навыкам.
 *
 * Все числа спроса, покрытия и дефицита — по шкале 0–100.
 */

/** Навык продукта, который закрывает дефицит программы. */
export interface ProductMatchSkillDto {
  skillId: string
  name: string
  /** Спрос рынка 0–100 (нормирован по всем навыкам периода). */
  demand: number
  /** Покрытие программой 0–100: нет — 0, базовый — 34, средний — 67, продвинутый — 100. */
  coverage: number
  /** Уровень в программе; null — навыка в программе нет. */
  level: SkillLevel | null
  /** Дефицит 0–100 = спрос − покрытие, не меньше нуля. */
  gap: number
  relevance: ProductSkillRelevance
  /** Вне профиля направления (решение 98): учтён с половинным весом. */
  outOfProfile: boolean
  /** Сырой замер спроса — для причин: «1 240 вакансий». */
  demandValue: number
  demandUnit: string
}

/** Поправка к баллу — со знаком и объяснением. */
export interface ProductMatchAdjustmentDto {
  kind: 'same-university' | 'recent-cancel'
  /** Отрицательное число пунктов. */
  points: number
  text: string
}

export interface ProductRecommendationDto {
  program: { id: string; name: string; universityId: string; universityName: string }
  product: { id: string; name: string; category: string }
  /** Итоговый балл 0–100 — с поправками. */
  score: number
  /** Балл по навыкам до поправок. */
  baseScore: number
  adjustments: ProductMatchAdjustmentDto[]
  /** Дефицитные навыки программы, которые даёт продукт, — от большего дефицита к меньшему. */
  closes: ProductMatchSkillDto[]
  /** Сколько навыков у продукта всего и сколько из них с рыночными данными. */
  productSkillCount: number
  productSkillsWithDemand: number
  /** 2–4 причины простыми словами, с цифрами. */
  reasons: string[]
  confidence: ConfidenceLevel
  /** Почему такая уверенность: чего не хватает в данных. */
  confidenceNote: string
  /** Данных мало — пометка на экране. */
  lowData: boolean
}

/** Продукт, который программе не предлагается, и почему. */
export interface ProductMatchExcludedDto {
  productId: string
  productName: string
  programId: string
  reason: string
}

export type ProductRecommendationScope = 'program' | 'university' | 'portfolio'

/** Кому письмо: основной контакт вуза с маской ФИО (персональные данные на экран не выводятся). */
export interface ProductOfferRecipientDto {
  /** «С******* О. В.» — первая буква фамилии и инициалы. null — контактов у вуза нет. */
  maskedName: string | null
  position: string | null
}

export interface ProductRecommendationsDto {
  scope: ProductRecommendationScope
  /** Период рыночных данных; null — данных нет, рекомендовать не на чем. */
  period: string | null
  isMock: boolean
  items: ProductRecommendationDto[]
  /** Сколько подходящих пар нашлось всего — до обрезания по лимиту. */
  total: number
  excluded: ProductMatchExcludedDto[]
  /** Действующие продукты без навыков: сравнить их с программой не по чему. */
  productsWithoutSkills: string[]
  /** Вывод одной фразой под заголовком. */
  summary: string
  /** Как считается — одной строкой для подсказки. */
  method: string
  /** Что может текущий пользователь: решает сервер, эксперт — только читает. */
  actions: { canDraftLetter: boolean; canCreateCooperation: boolean }
}
