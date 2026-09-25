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
