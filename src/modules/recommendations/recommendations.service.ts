import { conflict, notFound } from '@/shared/http/errors'
import { describeForLog } from '@/shared/db/log'
import { pageMeta } from '@/shared/http/pagination'
import { assertCan, universityScope } from '@/shared/auth/permissions'
import { writeAudit } from '@/shared/audit/audit'
import { RECOMMENDATION_RULES, SKILL_GAP } from '@/shared/config/analytics.config'
import type { CurrentUser } from '@/shared/auth/current-user'
import type { PageMeta } from '@/shared/contracts/common'
import type {
  RecommendationDto,
  RecommendationGenerationResultDto,
  RecommendationTargetDto,
} from '@/shared/contracts/recommendation'
import type { SkillLevel } from '@/shared/contracts/enums'
import { toIso, toIsoRequired } from '@/shared/utils/date'
import { demandNormalizer, demandPerSkill } from '@/modules/skills/skills.rules'
import * as repo from './recommendations.repo'
import { withControlGroup } from './experiment/experiment.service'
import { ensureStageDurations } from '@/modules/analytics/stage-analytics.service'
import {
  assertRecommendationTransition,
  compareDraftsByImportance,
  draftsForCooperation,
  isConditionChecked,
  recommendationKey,
  ruleCriticalGapWithProduct,
  ruleMissingProgramMetrics,
  stillActualMessage,
  type RecommendationDraft,
} from './recommendations.rules'
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

function missingMetricsDraft(program: {
  id: string
  name: string
  applicationCount: number | null
  studentCount: number | null
  groupCount: number | null
  university: { name: string }
  _count: { cooperations: number }
}): RecommendationDraft | null {
  return ruleMissingProgramMetrics({
    programId: program.id,
    programName: program.name,
    universityName: program.university.name,
    applicationCount: program.applicationCount,
    studentCount: program.studentCount,
    groupCount: program.groupCount,
    hasCooperation: program._count.cooperations > 0,
  })
}

const LEVEL_ORDER: Record<SkillLevel, number> = { BASIC: 1, INTERMEDIATE: 2, ADVANCED: 3 }

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
  const drafts: RecommendationDraft[] = []

  // ── Правила по связкам ─────────────────────────────────────────────────────
  for (const cooperation of input.cooperations) {
    drafts.push(...draftsForCooperation(cooperation, now))
  }

  // ── Правило по недостающим показателям программ ────────────────────────────
  for (const program of input.programs) {
    const draft = missingMetricsDraft(program)
    if (draft) drafts.push(draft)
  }

  // ── Правило по критичным дефицитам навыков ─────────────────────────────────
  // Одна строка на навык — как в списке дефицитов (demandPerSkill): иначе два
  // региональных замера одного навыка дали бы две рекомендации с одним ключом,
  // и вторая молча затёрла бы первую.
  const demand = demandPerSkill(input.demand)
  const normalizeValue = demandNormalizer(demand.map((row) => row.value))

  /** Лучший уровень навыка по каждой программе — нужен, чтобы понять, покрыт ли он. */
  const levelByProgramSkill = new Map<string, SkillLevel>()
  for (const row of input.programSkills) {
    const key = `${row.programId}::${row.skillId}`
    const current = levelByProgramSkill.get(key)
    if (!current || LEVEL_ORDER[row.level] > LEVEL_ORDER[current]) {
      levelByProgramSkill.set(key, row.level)
    }
  }

  const productsBySkill = new Map<string, Array<{ id: string; name: string; relevance: string }>>()
  for (const row of input.productSkills) {
    const list = productsBySkill.get(row.skillId) ?? []
    list.push({ id: row.product.id, name: row.product.name, relevance: row.relevance })
    productsBySkill.set(row.skillId, list)
  }

  const gapDrafts: RecommendationDraft[] = []
  for (const row of demand) {
    const normalized = normalizeValue(row.value)
    if (normalized === null || normalized < SKILL_GAP.demandThreshold) continue

    // Программы, в которых этого навыка нет вовсе.
    const programsWithoutSkill = input.programs.filter(
      (program) => !levelByProgramSkill.has(`${program.id}::${row.skillId}`),
    )
    // Навык считается дефицитным только если его нет НИ В ОДНОЙ программе:
    // иначе это не дефицит, а неравномерное покрытие.
    if (programsWithoutSkill.length !== input.programs.length) continue

    const draft = ruleCriticalGapWithProduct({
      skillId: row.skillId,
      skillName: row.skill.name,
      demandNormalized: normalized,
      products: productsBySkill.get(row.skillId) ?? [],
      programs: programsWithoutSkill.map((program) => ({
        id: program.id,
        name: program.name,
        universityName: program.university.name,
      })),
    })
    if (draft) gapDrafts.push(draft)
  }

  gapDrafts.sort(
    (a, b) =>
      Number(b.relatedData.demandNormalized ?? 0) - Number(a.relatedData.demandNormalized ?? 0),
  )

  // Лимит ограничивает, сколько дефицитов попадёт в список за раз. Но те, что за лимитом,
  // остаются актуальными: их ключи всё равно уходят в проверку на устаревание, иначе
  // система закрыла бы их как выполненные, хотя дефицит никуда не делся.
  const shownGaps = gapDrafts.slice(0, RECOMMENDATION_RULES.criticalGapLimit)
  const deferredGaps = gapDrafts.slice(RECOMMENDATION_RULES.criticalGapLimit)
  drafts.push(...shownGaps)

  // ── Сохранение ─────────────────────────────────────────────────────────────
  // В порядке ленты: новые записи получают время создания по этому порядку,
  // и при равной важности лента и главная показывают их одинаково всегда.
  drafts.sort(compareDraftsByImportance)
  // Контрольная группа (решение 126): сигнал пишется в журнал всегда, рекомендация
  // из контроля не создаётся. Ключи контроля остаются среди актуальных — не закрываются.
  const { created, updated, keys } = await withControlGroup(drafts, now, (shown) =>
    repo.upsertDrafts(shown, now),
  )
  const stillActualKeys = [
    ...keys,
    ...deferredGaps.map(recommendationKey),
  ]
  const closed = await repo.closeObsolete(stillActualKeys)

  await writeAudit({
    userId: user.id,
    action: 'recommendation.generate',
    objectType: 'Recommendation',
    objectId: 'batch',
    payload: { created, updated, closed, total: drafts.length },
  })

  return {
    created,
    updated,
    closed,
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
    await ensureStageDurations()
    const cooperation = await repo.loadCooperationForRules(cooperationId)
    const drafts = cooperation ? draftsForCooperation(cooperation, new Date()) : []
    await repo.syncCooperation(cooperationId, drafts)
  } catch (error) {
    console.error('[RECOMMENDATIONS] не удалось сверить рекомендации связки', describeForLog(error))
  }
}
