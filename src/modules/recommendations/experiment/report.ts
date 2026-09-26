import {
  EXPERIMENT_RULE_LABELS,
  EXPERIMENT_STATUS_LABELS,
  type ExperimentArm,
  type ExperimentRuleStatsDto,
  type ExperimentStatsDto,
  type ExperimentStatus,
  type RecommendationExperimentDto,
} from '@/shared/contracts/recommendation-experiment'
import { cappedDays, type Outcome } from './outcome'
import {
  momentsOf,
  newcombeDifference,
  normalQuantile,
  sequentialTest,
  welchInterval,
  type Interval,
} from './stats'

/**
 * Сводка эксперимента из журнала сигналов с исходами (решение 136). Чистая функция:
 * её же вызывает симуляция — отчёт по настоящим и по выдуманным данным считается одним кодом.
 *
 * Принцип «по назначению» (intention-to-treat): в знаменателе все сигналы группы
 * с известным исходом — показанные и забытые, взятые в работу и отклонённые. Сравнивается
 * то, что назначено случайно, а не то, что человек выбрал сделать.
 */

export interface ReportSignal {
  ruleType: string
  arm: ExperimentArm
  assignedBy: string
  firedAt: Date
  outcome: Outcome
  /** Доля контроля в момент назначения — чтобы заметить смену c по ходу. */
  controlShare: number | null
}

export interface ReportSettings {
  enabled: boolean
  controlShare: number
  horizonDays: number
  minControlForVerdict: number
  confidenceLevel: number
  sequentialAlpha: number
  sequentialBeta: number
  sequentialRelativeLift: number
  /** Правила, которые в контроль не уходят никогда. */
  neverControlRules: readonly string[]
}

/** Вывод по интервалу и объёму. Порог — по меньшей из групп: обычно это контроль. */
export function experimentStatus(
  nTreatment: number,
  nControl: number,
  ci: Interval | null,
  minPerArm: number,
): ExperimentStatus {
  if (ci === null || nControl < minPerArm || nTreatment < minPerArm) return 'insufficient-data'
  if (ci.low > 0) return 'lift'
  if (ci.high < 0) return 'negative'
  return 'not-proven'
}

export function compareArms(signals: readonly ReportSignal[], settings: ReportSettings): ExperimentStatsDto {
  const randomized = signals.filter((signal) => signal.assignedBy === 'hash')
  const decided = randomized.filter(
    (signal) => signal.outcome.state === 'success' || signal.outcome.state === 'failure',
  )
  const pending = randomized.filter((signal) => signal.outcome.state === 'pending')
  const arm = (name: ExperimentArm) => decided.filter((signal) => signal.arm === name)
  const treatment = arm('treatment')
  const control = arm('control')
  const successes = (rows: readonly ReportSignal[]) => rows.filter((row) => row.outcome.state === 'success').length

  const nT = treatment.length
  const nC = control.length
  const sT = successes(treatment)
  const sC = successes(control)
  const convT = nT > 0 ? sT / nT : null
  const convC = nC > 0 ? sC / nC : null
  const lift = convT !== null && convC !== null ? convT - convC : null
  const relativeLift = lift !== null && convC !== null && convC > 0 ? lift / convC : null

  const z = normalQuantile(1 - (1 - settings.confidenceLevel) / 2)
  const ci = nT > 0 && nC > 0 ? newcombeDifference(sT, nT, sC, nC, z) : null

  const days = (rows: readonly ReportSignal[]) =>
    momentsOf(rows.map((row) => cappedDays(row.outcome, settings.horizonDays) ?? settings.horizonDays))
  const welch = welchInterval(days(treatment), days(control), settings.confidenceLevel)

  // Успехи в порядке наступления — так их увидела бы проверка, запущенная после каждого.
  const successArms = decided
    .filter((row) => row.outcome.state === 'success')
    .sort((a, b) => (a.outcome.at?.getTime() ?? 0) - (b.outcome.at?.getTime() ?? 0))
    .map((row) => row.arm)
  const sequential = sequentialTest(successArms, {
    controlShare: settings.controlShare,
    relativeLift: settings.sequentialRelativeLift,
    alpha: settings.sequentialAlpha,
    beta: settings.sequentialBeta,
  })

  const status = experimentStatus(nT, nC, ci, settings.minControlForVerdict)
  const firstFired = randomized.reduce<Date | null>(
    (min, row) => (min === null || row.firedAt < min ? row.firedAt : min),
    null,
  )

  return {
    nTreatment: nT,
    nControl: nC,
    successesTreatment: sT,
    successesControl: sC,
    convT,
    convC,
    lift,
    relativeLift,
    ci,
    days: welch
      ? { meanTreatment: welch.meanA, meanControl: welch.meanB, diff: welch.diff, ci: welch.ci, df: welch.df }
      : null,
    sequential,
    status,
    statusLabel: EXPERIMENT_STATUS_LABELS[status],
    pendingTreatment: pending.filter((row) => row.arm === 'treatment').length,
    pendingControl: pending.filter((row) => row.arm === 'control').length,
    since: firstFired ? firstFired.toISOString() : null,
  }
}

export function buildExperimentReport(
  signals: readonly ReportSignal[],
  settings: ReportSettings,
  now: Date,
): RecommendationExperimentDto {
  const ruleTypes = [...new Set([...Object.keys(EXPERIMENT_RULE_LABELS), ...signals.map((row) => row.ruleType)])]
  const rules: ExperimentRuleStatsDto[] = ruleTypes.map((ruleType) => ({
    ruleType,
    label: EXPERIMENT_RULE_LABELS[ruleType] ?? ruleType,
    controlEligible: !settings.neverControlRules.includes(ruleType),
    ...compareArms(
      signals.filter((row) => row.ruleType === ruleType),
      settings,
    ),
  }))

  const byAssignment: Record<string, number> = {}
  for (const row of signals) byAssignment[row.assignedBy] = (byAssignment[row.assignedBy] ?? 0) + 1

  const warnings: string[] = []
  const shares = new Set(
    signals
      .filter((row) => row.assignedBy === 'hash' && row.controlShare !== null)
      .map((row) => row.controlShare),
  )
  if (shares.size > 1) {
    warnings.push(
      'Доля контроля менялась по ходу эксперимента: общий итог смешивает периоды с разной долей, ' +
        'надёжнее выводы по каждому правилу и периоду отдельно.',
    )
  }
  if (!settings.enabled) {
    warnings.push(
      'Эксперимент выключен: новые сигналы не уходят в контроль, журнал пишется, ' +
        'сравнение считается по ранее назначенным.',
    )
  }

  return {
    enabled: settings.enabled,
    controlShare: settings.controlShare,
    horizonDays: settings.horizonDays,
    minControlForVerdict: settings.minControlForVerdict,
    confidenceLevel: settings.confidenceLevel,
    overall: compareArms(signals, settings),
    rules,
    journal: {
      total: signals.length,
      randomized: signals.filter((row) => row.assignedBy === 'hash').length,
      byAssignment,
    },
    warnings,
    generatedAt: now.toISOString(),
  }
}
