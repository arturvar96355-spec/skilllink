import { createHash } from 'node:crypto'
import { RECOMMENDATION_EXPERIMENT } from '@/shared/config/analytics.config'
import { CONTROL_POINT_STAGES } from '@/shared/config/workflow.config'
import type { RecommendationPriority } from '@/shared/contracts/enums'
import type { ExperimentArm } from '@/shared/contracts/recommendation-experiment'

/**
 * Назначение сигнала в группу (решение 136).
 *
 * Чистые функции без базы: одинаковый сигнал — одинаковая группа при любом порядке
 * обработки, на любой машине и при любом числе пересборок. Поэтому назначение
 * воспроизводимо: по журналу его можно пересчитать и проверить.
 */

/** Как назначена группа. Только `hash` — случайное назначение, участвующее в оценке. */
export const ASSIGNED_BY = [
  'hash',
  'experiment-off',
  'excluded-rule',
  'already-shown',
  'dismissed',
  'resolved',
] as const
export type AssignedBy = (typeof ASSIGNED_BY)[number]

export interface ExperimentSettings {
  enabled: boolean
  controlShare: number
  horizonDays: number
  salt: string
  neverControlRules: readonly string[]
}

/** Действующие параметры из конфига. Тесты передают свои. */
export function experimentSettings(): ExperimentSettings {
  return {
    enabled: RECOMMENDATION_EXPERIMENT.enabled,
    controlShare: effectiveControlShare(RECOMMENDATION_EXPERIMENT.controlShare),
    horizonDays: RECOMMENDATION_EXPERIMENT.horizonDays,
    salt: RECOMMENDATION_EXPERIMENT.salt,
    neverControlRules: RECOMMENDATION_EXPERIMENT.neverControlRules,
  }
}

/** Доля контроля в пределах 0…потолок: опечатка в конфиге не спрячет половину рекомендаций. */
export function effectiveControlShare(
  share: number,
  max: number = RECOMMENDATION_EXPERIMENT.maxControlShare,
): number {
  if (!Number.isFinite(share) || share <= 0) return 0
  return Math.min(share, max)
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Период назначения — отрезок длиной H дней от 01.01.1970 UTC. Период входит в хеш:
 * объект, у которого проблема держится месяцами, в каждом новом окне получает группу
 * заново, а не сидит в контроле вечно.
 */
export function periodKey(at: Date, horizonDays: number): string {
  const day = Math.floor(at.getTime() / DAY_MS)
  return `${horizonDays}d-${Math.floor(day / horizonDays)}`
}

/** Сигнал: какое правило сработало, по какому объекту и в каком периоде. */
export interface SignalKey {
  ruleType: string
  entityType: string
  entityId: string
  periodKey: string
}

/**
 * Равномерное число 0 ≤ u < 1 из SHA-256 ключа сигнала: первые 52 бита хеша
 * (столько точно помещается в double). Соль отделяет один эксперимент от другого.
 */
export function assignmentUniform(key: SignalKey, salt: string): number {
  const digest = createHash('sha256')
    .update([salt, key.ruleType, key.entityType, key.entityId, key.periodKey].join('|'))
    .digest('hex')
  return Number.parseInt(digest.slice(0, 13), 16) / 2 ** 52
}

/** Что правило знает о сигнале, кроме ключа, — для решения «можно ли придержать». */
export interface SignalTraits {
  priority: RecommendationPriority
  /** Для правил по связке — номер этапа, о котором говорит рекомендация. */
  stageNumber?: number | null
}

/**
 * Можно ли вообще придержать сигнал. Никогда — просрочка срока (в том числе у
 * контрольной точки), связка без продукта на оформлении, застой на контрольной
 * точке и всё, что правило само назвало критичным. Контроль — задержка сигнала
 * низкой срочности, а не «спрятать важное».
 */
export function isControlEligible(
  key: Pick<SignalKey, 'ruleType'>,
  traits: SignalTraits,
  settings: Pick<ExperimentSettings, 'neverControlRules'>,
): boolean {
  if (settings.neverControlRules.includes(key.ruleType)) return false
  if (traits.priority === 'CRITICAL') return false
  if (
    key.ruleType === 'cooperation.stalled' &&
    traits.stageNumber != null &&
    CONTROL_POINT_STAGES.includes(traits.stageNumber)
  ) {
    return false
  }
  return true
}

/**
 * Что уже было с рекомендацией по этому ключу до сигнала. Решает, можно ли
 * назначать случайно: если рекомендацию сотрудник уже видит (открыта), отклонил
 * или закрыл так, что пересборка её не откроет, — показать или не показать её
 * сейчас нельзя, и сигнал в оценку не идёт. Закрытую, которую пересборка откроет
 * заново, назначать можно: для сотрудника это новая рекомендация.
 */
export type PriorRecommendation = 'none' | 'open' | 'dismissed' | 'resolved' | 'reopenable'

export interface Assignment {
  arm: ExperimentArm
  assignedBy: AssignedBy
}

/**
 * Группа сигнала. Порядок проверок важен: сначала всё, что выводит сигнал из
 * эксперимента, и только потом хеш. Все исключения решаются по данным до назначения —
 * иначе сравнение групп было бы нечестным.
 */
export function assignArm(
  key: SignalKey,
  traits: SignalTraits,
  prior: PriorRecommendation,
  settings: ExperimentSettings,
): Assignment {
  if (!settings.enabled || settings.controlShare <= 0) {
    return { arm: 'treatment', assignedBy: 'experiment-off' }
  }
  if (!isControlEligible(key, traits, settings)) return { arm: 'treatment', assignedBy: 'excluded-rule' }
  if (prior === 'open') return { arm: 'treatment', assignedBy: 'already-shown' }
  if (prior === 'dismissed') return { arm: 'treatment', assignedBy: 'dismissed' }
  if (prior === 'resolved') return { arm: 'treatment', assignedBy: 'resolved' }
  const arm = assignmentUniform(key, settings.salt) < settings.controlShare ? 'control' : 'treatment'
  return { arm, assignedBy: 'hash' }
}
