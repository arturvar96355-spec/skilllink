import { conflict, notFound } from '@/shared/http/errors'
import { pageMeta } from '@/shared/http/pagination'
import { assertCan, universityScope } from '@/shared/auth/permissions'
import { writeAudit } from '@/shared/audit/audit'
import { RECOMMENDATION_LEARNING } from '@/shared/config/analytics.config'
import type { CurrentUser } from '@/shared/auth/current-user'
import type { PageMeta } from '@/shared/contracts/common'
import type {
  RecommendationDto,
  RecommendationGenerationResultDto,
  RecommendationScoreDto,
  RecommendationTargetDto,
} from '@/shared/contracts/recommendation'
import { toIso, toIsoRequired } from '@/shared/utils/date'
import { findCurrentStage } from '@/modules/workflow/workflow.rules'
import * as repo from './recommendations.repo'
import { log } from '@/shared/log/logger'
import * as statsRepo from './recommendations.stats.repo'
import { ensureStageDurations } from '@/modules/analytics/stage-analytics.service'
import {
  assertRecommendationTransition,
  compareDraftsByImportance,
  draftsForCooperation,
  evaluateCooperation,
  evaluateProgram,
  evaluateSkillGaps,
  isConditionChecked,
  progressedSince,
  recommendationKey,
  stillActualMessage,
  type ProgramForRules,
  type RecommendationDraft,
  type RuleEvaluation,
} from './recommendations.rules'
import { isRuleEnabled } from './recommendations.explain'
import { parseReasons } from './recommendations.reasons'
import { DAY_MS } from './recommendations.learning'
import { rescoreOpen } from './recommendations.learning.service'
import type {
  RecommendationListQuery,
  UpdateRecommendationInput,
} from './recommendations.schema'

function toTarget(
  row: repo.RecommendationRow,
  labels: ReadonlyMap<string, string>,
): RecommendationTargetDto {
  return {
    objectType: row.objectType as RecommendationTargetDto['objectType'],
    objectId: row.objectId,
    // Имя объекта, а не заголовок: заголовок объект не называет — «Просрочен
    // этап 6» не говорит, какой вуз. Заголовок — только запасной вариант,
    // если объект уже удалён.
    label: labels.get(repo.targetKey(row.objectType, row.objectId)) ?? row.title,
  }
}

/** Рекомендации в DTO вместе с именами объектов — для списков, карточки и дашборда. */

export async function toRecommendationDtos(
  rows: readonly repo.RecommendationRow[],
): Promise<RecommendationDto[]> {
  const labels = await repo.resolveTargetLabels(rows)
  return rows.map((row) => toRecommendationDto(row, labels))
}

/**
 * Единственный мэппер рекомендации в DTO. Имена объектов — из `labels`:
 * их собирает `toRecommendationDtos` одним запросом на страницу.
 */
export function toRecommendationDto(
  row: repo.RecommendationRow,
  labels: ReadonlyMap<string, string> = new Map(),
): RecommendationDto {
  return {
    id: row.id,
    type: row.type,
    ruleKey: row.ruleKey,
    title: row.title,
    description: row.description,
    priority: row.priority,
    justification: row.justification,
    relatedData: (row.relatedData as Record<string, unknown> | null) ?? null,
    confidence: row.confidence,
    status: row.status,
    resolutionComment: row.resolutionComment,
    target: toTarget(row, labels),
    cooperationId: row.cooperationId,
    createdAt: toIsoRequired(row.createdAt),
    updatedAt: toIsoRequired(row.updatedAt),
    resolvedAt: toIso(row.resolvedAt),
    score: row.score,
    scoreBreakdown: toScoreBreakdown(row.scoreBreakdown),
    reasons: parseReasons(row.reasons),
    isDeferred: row.isDeferred,
  }
}

/** Разбор балла из базы: объект с числом `score` — иначе null (запись ещё не пересчитана). */
function toScoreBreakdown(value: unknown): RecommendationScoreDto | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  return typeof (value as { score?: unknown }).score === 'number' ? (value as RecommendationScoreDto) : null
}

/**
 * Побочная работа обучения (статистика, пересчёт балла) не должна отменять уже
 * записанное: сбой — в журнал сервера, недосчитанное поправит следующая пересборка.
 */
async function learningStep(label: string, step: () => Promise<unknown>): Promise<void> {
  try {
    await step()
  } catch (error) {
    log.error(`[RECOMMENDATIONS] обучение: ${label}`, { err: error })
  }
}

export async function list(
  user: CurrentUser,
  query: RecommendationListQuery,
): Promise<{ data: RecommendationDto[]; meta: PageMeta }> {
  // Представитель вуза рекомендаций не видит: это внутренняя аналитика ИТ-Школы.
  assertCan(user, 'ANALYTICS')
  const { rows, total } = await repo.findMany(query, universityScope(user))
  return {
    data: await toRecommendationDtos(rows),
    meta: pageMeta({ page: query.page, pageSize: query.pageSize }, total),
  }
}

export async function getById(user: CurrentUser, id: string): Promise<RecommendationDto> {
  assertCan(user, 'ANALYTICS')
  const row = await repo.findById(id)
  if (!row) throw notFound('Рекомендация не найдена')
  return (await toRecommendationDtos([row]))[0]!
}

function missingMetricsDraft(program: ProgramForRules): RecommendationDraft | null {
  return evaluateProgram(program).draft
}

/**
 * Прогоняет все правила и сохраняет результат.
 *
 * Рекомендации пересобираются целиком: открытые (в том числе принятые), которые
 * правила больше не выдают, закрываются системой — висеть «Новой» неправде незачем.
 * Закрытые, чья проблема снова есть, открываются (`shouldReopen`). Отклонённые
 * с основанием не переписываются никогда.
 */
export async function generate(user: CurrentUser): Promise<RecommendationGenerationResultDto> {
  assertCan(user, 'ANALYTICS_WORK')

  const now = new Date()
  // Порог застоя по истории этапов (решение 120): правило берёт его из памяти.
  await ensureStageDurations(now)
  const input = await repo.loadGenerationInput()
  const evaluations: RuleEvaluation[] = []

  // ── Правила по связкам ─────────────────────────────────────────────────────
  for (const cooperation of input.cooperations) {
    evaluations.push(...evaluateCooperation(cooperation, now))
  }

  // ── Правило по недостающим показателям программ ────────────────────────────
  for (const program of input.programs) evaluations.push(evaluateProgram(program))

  // ── Правило по критичным дефицитам навыков ─────────────────────────────────
  // Лимит показа общий на все навыки — правило считается по всем сразу; те, что
  // за лимитом, остаются актуальными и не закрываются как выполненные.
  const gaps = evaluateSkillGaps(input)

  const candidates = [
    ...evaluations.flatMap((item) => (item.draft ? [item.draft] : [])),
    ...gaps.shown,
  ]
  // Выключенное правило (решение 119) молчит: новых записей не создаёт, но и его
  // открытые записи, пока условие выполняется, не закрываются как выполненные.
  const drafts = candidates.filter((draft) => isRuleEnabled(draft.ruleKey))
  const silenced = candidates.filter((draft) => !isRuleEnabled(draft.ruleKey))

  // ── Сохранение ─────────────────────────────────────────────────────────────
  // В порядке ленты: новые записи получают время создания по этому порядку,
  // и при равной важности лента и главная показывают их одинаково всегда.
  drafts.sort(compareDraftsByImportance)
  const { created, updated, keys, shown } = await repo.upsertDrafts(drafts, now)
  const stillActualKeys = [
    ...keys,
    ...gaps.deferred.map(recommendationKey),
    ...silenced.map(recommendationKey),
  ]
  const closed = await repo.closeObsolete(stillActualKeys)

  // ── Обучение (решение 119) ─────────────────────────────────────────────────
  // Показ — в статистику правила. Закрытое системой засчитывается полезным, только
  // если объект по-прежнему в работе: проблема ушла, а не связку отменили.
  const live = new Set([
    ...input.cooperations.map((row) => repo.targetKey('Cooperation', row.id)),
    ...input.programs.map((row) => repo.targetKey('EducationalProgram', row.id)),
    ...input.demand.map((row) => repo.targetKey('Skill', row.skillId)),
  ])
  await learningStep('показы', () => statsRepo.recordShows(shown, now))
  await learningStep('выполненные системой', () =>
    statsRepo.creditSuccesses(
      closed.filter((row) => live.has(repo.targetKey(row.objectType, row.objectId))).map((row) => row.id),
      now,
    ),
  )
  await learningStep('пересчёт балла', () => rescoreOpen(now))

  await writeAudit({
    userId: user.id,
    action: 'recommendation.generate',
    objectType: 'Recommendation',
    objectId: 'batch',
    payload: { created, updated, closed: closed.length, total: drafts.length },
  })

  return {
    created,
    updated,
    closed: closed.length,
    total: drafts.length,
    generatedAt: now.toISOString(),
  }
}

/**
 * Что правило рекомендации выдаёт по её объекту прямо сейчас.
 * null — условие больше не выполняется: проблема ушла.
 */
async function currentDraft(
  row: { ruleKey: string; objectType: string; objectId: string },
  now: Date,
): Promise<RecommendationDraft | null> {
  if (row.objectType === 'Cooperation') {
    await ensureStageDurations(now)
    const cooperation = await repo.loadCooperationForRules(row.objectId)
    if (!cooperation) return null
    return draftsForCooperation(cooperation, now).find((draft) => draft.ruleKey === row.ruleKey) ?? null
  }
  if (row.objectType === 'EducationalProgram') {
    const program = await repo.loadProgramForRules(row.objectId)
    return program ? missingMetricsDraft(program) : null
  }
  return null
}

/**
 * Сотрудник меняет статус рекомендации.
 *
 * Переход проверяется по общей с интерфейсом таблице: `DONE → NEW` руками
 * не делается — закрытую, если проблема вернулась, открывает пересборка.
 *
 * Закрыть (`DONE`) рекомендацию с проверяемым условием можно, только когда
 * условие ушло. Иначе «Закрыть» убирает просроченный этап с главной, а он
 * по-прежнему просрочен. Не согласен с рекомендацией — отклонить с основанием.
 */
export async function updateStatus(
  user: CurrentUser,
  id: string,
  input: UpdateRecommendationInput,
): Promise<RecommendationDto> {
  assertCan(user, 'ANALYTICS_WORK')

  const existing = await repo.findById(id)
  if (!existing) throw notFound('Рекомендация не найдена')

  assertRecommendationTransition(existing.status, input.status)

  if (input.status === 'DONE' && isConditionChecked(existing.ruleKey)) {
    const draft = await currentDraft(existing, new Date())
    if (draft) {
      throw conflict(stillActualMessage(draft), {
        ruleKey: existing.ruleKey,
        reason: 'CONDITION_STILL_HOLDS',
        relatedData: draft.relatedData,
      })
    }
  }

  const row = await repo.updateStatus(id, existing.status, input.status, user.id, input.comment ?? null)
  if (!row) {
    throw conflict('Рекомендацию уже изменили. Обновите страницу и повторите действие.', {
      expectedStatus: existing.status,
    })
  }

  await writeAudit({
    userId: user.id,
    action: 'recommendation.status.change',
    objectType: 'Recommendation',
    objectId: id,
    payload: { from: existing.status, to: input.status, ruleKey: existing.ruleKey },
  })

  // Решение 119: выполненная — успех правила; вес правила меняется, и балл
  // открытых рекомендаций пересчитывается сразу. Отклонение в статистике — показ
  // без успеха: показ уже учтён при создании, отдельного события нет.
  if (input.status === 'DONE') {
    const now = new Date()
    await learningStep('выполненная', () => statsRepo.creditSuccesses([id], now))
    await learningStep('пересчёт балла', () => rescoreOpen(now))
  }

  return (await toRecommendationDtos([row]))[0]!
}

/**
 * Сверяет открытые рекомендации связки с её этапами — после смены статуса
 * или срока этапа. Завершили просроченный этап — «Просрочен этап 6» закрывается
 * сразу, а не висит «Новой» до пересборки; просрочка перешла на следующий этап —
 * рекомендация говорит о нём.
 *
 * Вызывается после транзакции этапа и не бросает: сбой сверки не должен
 * отменять уже записанную смену статуса. Недосверенное доделает пересборка.
 */
export async function syncCooperation(cooperationId: string): Promise<void> {
  try {
    const now = new Date()
    await ensureStageDurations(now)
    // Кандидаты на бонус — до сверки: сверка переписывает их данные на сегодняшние
    // (просрочка переходит на следующий этап), а сравнивать надо с тем, что было.
    const candidates = await repo.findProgressCandidates(
      cooperationId,
      new Date(now.getTime() - RECOMMENDATION_LEARNING.progressCreditDays * DAY_MS),
    )
    const cooperation = await repo.loadCooperationForRules(cooperationId)
    const drafts = cooperation ? draftsForCooperation(cooperation, now) : []
    const { closed } = await repo.syncCooperation(cooperationId, drafts)
    if (!cooperation) return

    // Решение 119: проблема ушла, связка в работе — рекомендация помогла; связка
    // сдвинулась на следующий этап в течение окна после показа — тоже.
    const currentStage = findCurrentStage(cooperation.stages)?.stageNumber ?? null
    const credited = new Set([
      ...closed.map((row) => row.id),
      ...candidates
        .filter((row) => progressedSince(row.ruleKey, row.relatedData, currentStage))
        .map((row) => row.id),
    ])
    if (credited.size === 0) return
    await learningStep('сдвиг связки', () => statsRepo.creditSuccesses([...credited], now))
    await learningStep('пересчёт балла', () => rescoreOpen(now))
  } catch (error) {
    log.error('[RECOMMENDATIONS] не удалось сверить рекомендации связки', { cooperationId, err: error })
  }
}
