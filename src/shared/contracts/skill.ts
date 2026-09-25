import type { ConfidenceLevel, SkillImportance, SkillLevel } from './enums'

export interface SkillDto {
  id: string
  name: string
  category: string
  description: string | null
  programCount: number
  productCount: number
}

/** Востребованность навыка на рынке (решение 11). Происхождение обязательно. */
export interface SkillDemandDto {
  skillId: string
  name: string
  category: string
  period: string
  value: number | null
  unit: string
  /** Спрос, приведённый к 0..1 внутри выборки. null, если данных нет. */
  normalized: number | null
  /** Регион замера. Замер без указания региона приходит как «Россия». */
  region: string
  source: string | null
  confidence: ConfidenceLevel | null
  isMock: boolean
}

/** Дефицит навыка в программе (skill gap, P1). */
export interface SkillGapDto {
  skillId: string
  name: string
  category: string
  demand: number | null
  demandNormalized: number | null
  /** Покрытие навыка программой, 0..1. 0 — навыка в программе нет. */
  coverage: number
  level: SkillLevel | null
  importance: SkillImportance | null
  /** Размер дефицита: спрос минус покрытие, 0..1. */
  gap: number
  isCritical: boolean
  explanation: string
  /**
   * Дефицит вне профиля программы (решение 98): навык и его область не преподаёт
   * ни одна программа той же группы направлений. Такой дефицит не критический
   * и идёт после остальных. Только в разрезе одной программы (`programId`); иначе false.
   */
  outOfProfile: boolean
  isMock: boolean
}

/** Итог объединения дубля в целевой навык (решение 107). */
export interface SkillMergeResultDto {
  /** Целевой навык после объединения — со счётчиками программ и продуктов. */
  target: SkillDto
  /** Дубль удалён; имя — чтобы сказать, что именно объединено. */
  removed: { id: string; name: string }
  /**
   * Что стало со связями дубля: `moved` — перешли на целевой навык,
   * `combined` — у целевого уже была такая связь, осталась более сильная.
   */
  programs: { moved: number; combined: number }
  products: { moved: number; combined: number }
  demand: { moved: number; combined: number }
  /** Рекомендации по дублю: перенесены или удалены как повтор рекомендации целевого навыка. */
  recommendations: { moved: number; dropped: number }
}

/** Удалённый неиспользуемый навык. */
export interface SkillDeletedDto {
  id: string
  name: string
}
