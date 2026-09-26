import { assertCan } from '@/shared/auth/permissions'
import { log } from '@/shared/log'
import { RECOMMENDATION_EXPERIMENT } from '@/shared/config/analytics.config'
import type { CurrentUser } from '@/shared/auth/current-user'
import type {
  ExperimentArm,
  RecommendationExperimentDto,
} from '@/shared/contracts/recommendation-experiment'
import {
  OPEN_RECOMMENDATION_STATUSES,
  recommendationKey,
  shouldReopen,
  type RecommendationDraft,
} from '../recommendations.rules'
import {
  assignArm,
  experimentSettings,
  periodKey,
  type ExperimentSettings,
  type PriorRecommendation,
} from './assignment'
import * as repo from './experiment.repo'
import { evaluateOutcome, programIdsOf, type Outcome, type SignalContext } from './outcome'
import { buildExperimentReport, type ReportSettings } from './report'

/**
 * Контрольная группа рекомендаций (решение 136): журнал сигналов, назначение в группу,
 * исходы и отчёт. Выдача рекомендаций знает о нём ровно одну функцию — `withControlGroup`.
 */

const DAY_MS = 24 * 60 * 60 * 1000

function priorOf(
  row: { status: string; resolvedById: string | null; ruleKey: string } | undefined,
): PriorRecommendation {
  if (!row) return 'none'
  if ((OPEN_RECOMMENDATION_STATUSES as readonly string[]).includes(row.status)) return 'open'
  if (row.status === 'DISMISSED') return 'dismissed'
  return shouldReopen(row) ? 'reopenable' : 'resolved'
}

function identityOf(draft: RecommendationDraft): repo.SignalIdentity {
  return { ruleType: draft.ruleKey, entityType: draft.objectType, entityId: draft.objectId }
}

/** Номер этапа, о котором говорит рекомендация о застое, — для исключения контрольных точек. */
function stalledStage(draft: RecommendationDraft): number | null {
  if (draft.ruleKey !== 'cooperation.stalled') return null
  const value = Number(draft.relatedData.stageNumber)
  return Number.isFinite(value) ? value : null
}

function programIdsOfDraft(draft: RecommendationDraft): string[] | undefined {
  if (draft.objectType !== 'Skill') return undefined
  const programs = draft.relatedData.programs
  if (!Array.isArray(programs)) return []
  return programs
    .map((item) => (item as { id?: unknown }).id)
    .filter((id): id is string => typeof id === 'string')
}

export interface Routing {
  shown: RecommendationDraft[]
  withheld: RecommendationDraft[]
}

/**
 * Каждый черновик — сигнал в журнал; группа — по хешу. Сигнал, чьё окно ещё открыто,
 * повторно не назначается: пересборка через час не перетасует группы.
 */
export async function routeDrafts(
  drafts: readonly RecommendationDraft[],
  now: Date,
  settings: ExperimentSettings = experimentSettings(),
): Promise<Routing> {
  const identities = drafts.map(identityOf)
  const since = new Date(now.getTime() - settings.horizonDays * DAY_MS)
  const [open, prior, stages] = await Promise.all([
    repo.findOpenSignals(identities, since),
    repo.findPriorRecommendations(identities),
    repo.currentStageNumbers(drafts.filter((d) => d.objectType === 'Cooperation').map((d) => d.objectId)),
  ])

  const period = periodKey(now, settings.horizonDays)
  const arms = new Map<string, ExperimentArm>()
  const fresh: repo.NewSignal[] = []
  for (const draft of drafts) {
    const identity = identityOf(draft)
    const key = repo.signalIdentityKey(identity)
    const existing = open.get(key)
    if (existing) {
      arms.set(key, existing)
      continue
    }
    const assignment = assignArm(
      { ...identity, periodKey: period },
      { priority: draft.priority, stageNumber: stalledStage(draft) },
      priorOf(prior.get(key)),
      settings,
    )
    const context: SignalContext = {
      priority: draft.priority,
      controlShare: settings.enabled ? settings.controlShare : 0,
      horizonDays: settings.horizonDays,
      ...(draft.objectType === 'Cooperation' ? { stageNumber: stages.get(draft.objectId) ?? null } : {}),
      ...(draft.objectType === 'Skill' ? { programIds: programIdsOfDraft(draft) } : {}),
    }
    fresh.push({ ...identity, periodKey: period, firedAt: now, ...assignment, context })
    arms.set(key, assignment.arm)
  }

  await repo.createSignals(fresh)
  // Параллельная пересборка могла записать сигнал первой — верим журналу.
  for (const [key, arm] of await repo.storedArms(fresh, period)) {
    if (arms.has(key)) arms.set(key, arm)
  }

  const shown: RecommendationDraft[] = []
  const withheld: RecommendationDraft[] = []
  for (const draft of drafts) {
    if (arms.get(repo.signalIdentityKey(identityOf(draft))) === 'control') withheld.push(draft)
    else shown.push(draft)
  }
  return { shown, withheld }
}

export interface UpsertLike {
  created: number
  updated: number
  keys: string[]
}

/**
 * Единственная точка встраивания в выдачу: вместо `upsertDrafts(drafts)` —
 * `withControlGroup(drafts, now, (shown) => upsertDrafts(shown))`.
 *
 * Сигналы контроля в `upsert` не попадают, но их ключи возвращаются среди актуальных:
 * проблема никуда не делась, и закрывать что-то «как решённое» по ним нельзя.
 * Сбой журнала рекомендаций не прячет: показывается всё, как без эксперимента.
 */
export async function withControlGroup<T extends UpsertLike>(
  drafts: RecommendationDraft[],
  now: Date,
  upsert: (shown: RecommendationDraft[]) => Promise<T>,
): Promise<T & { withheld: number }> {
  let routing: Routing
  try {
    routing = await routeDrafts(drafts, now)
  } catch (error) {
    log.error('[RECOMMENDATIONS] журнал сигналов недоступен, показываем всё', { err: error })
    return { ...(await upsert(drafts)), withheld: 0 }
  }

  const result = await upsert(routing.shown)
  try {
    await repo.linkRecommendations()
    await refreshOutcomes(now)
  } catch (error) {
    log.error('[RECOMMENDATIONS] не удалось обновить исходы сигналов', { err: error })
  }
  return {
    ...result,
    keys: [...result.keys, ...routing.withheld.map(recommendationKey)],
    withheld: routing.withheld.length,
  }
}

/** Исходы всех сигналов, у которых он ещё не записан. Ожидающие — в памяти. */
async function evaluate(signals: readonly repo.StoredSignal[], now: Date): Promise<Map<string, Outcome>> {
  const undecided = signals.filter((signal) => signal.outcome === null)
  const result = new Map<string, Outcome>()
  if (undecided.length === 0) return result
  const since = undecided.reduce((min, row) => (row.firedAt < min ? row.firedAt : min), undecided[0]!.firedAt)
  const facts = await repo.loadOutcomeFacts(
    undecided.filter((row) => row.entityType === 'Cooperation').map((row) => row.entityId),
    undecided.flatMap((row) => programIdsOf(row)),
    since,
  )
  for (const signal of undecided) {
    const horizon = signal.context?.horizonDays ?? RECOMMENDATION_EXPERIMENT.horizonDays
    result.set(signal.id, evaluateOutcome(signal, facts, now, horizon))
  }
  return result
}

/** Дописывает в журнал исходы, которые уже известны: успех наступил или окно закрылось. */
export async function refreshOutcomes(now: Date = new Date()): Promise<number> {
  const signals = await repo.loadSignals({ onlyUndecided: true })
  const outcomes = await evaluate(signals, now)
  const decided = [...outcomes]
    .filter(([, outcome]) => outcome.state === 'success' || outcome.state === 'failure')
    .map(([id, outcome]) => ({ id, outcome, evaluatedAt: now }))
  await repo.saveOutcomes(decided)
  return decided.length
}

export function reportSettings(): ReportSettings {
  const settings = experimentSettings()
  return {
    enabled: settings.enabled,
    controlShare: settings.controlShare,
    horizonDays: settings.horizonDays,
    minControlForVerdict: RECOMMENDATION_EXPERIMENT.minControlForVerdict,
    confidenceLevel: RECOMMENDATION_EXPERIMENT.confidenceLevel,
    sequentialAlpha: RECOMMENDATION_EXPERIMENT.sequentialAlpha,
    sequentialBeta: RECOMMENDATION_EXPERIMENT.sequentialBeta,
    sequentialRelativeLift: RECOMMENDATION_EXPERIMENT.sequentialRelativeLift,
    neverControlRules: settings.neverControlRules,
  }
}

/**
 * Отчёт по журналу — только чтение: незаписанные исходы считаются в памяти,
 * записывает их пересборка рекомендаций.
 */
export async function buildReport(now: Date = new Date()): Promise<RecommendationExperimentDto> {
  const signals = await repo.loadSignals()
  const outcomes = await evaluate(signals, now)
  return buildExperimentReport(
    signals.map((signal) => ({
      ruleType: signal.ruleType,
      arm: signal.arm,
      assignedBy: signal.assignedBy,
      firedAt: signal.firedAt,
      outcome: signal.outcome ?? outcomes.get(signal.id) ?? { state: 'pending', days: null, event: null, at: null },
      controlShare: typeof signal.context?.controlShare === 'number' ? signal.context.controlShare : null,
    })),
    reportSettings(),
    now,
  )
}

/** `GET /api/recommendations/experiment` — те же права, что у ленты рекомендаций. */
export async function getExperimentReport(user: CurrentUser): Promise<RecommendationExperimentDto> {
  assertCan(user, 'ANALYTICS')
  return buildReport(new Date())
}
