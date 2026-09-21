import { notFound } from '@/shared/http/errors'
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
import { demandNormalizer } from '@/modules/skills/skills.rules'
import { findCurrentStage, isOverdue } from '@/modules/workflow/workflow.rules'
import * as repo from './recommendations.repo'
import {
  ruleCooperationWithoutProduct,
  ruleCriticalGapWithProduct,
  ruleMissingProgramMetrics,
  ruleOverdueStage,
  ruleStalledCooperation,
  type RecommendationDraft,
} from './recommendations.rules'
import type {
  RecommendationListQuery,
  UpdateRecommendationInput,
} from './recommendations.schema'

function toTarget(row: repo.RecommendationRow): RecommendationTargetDto {
  return {
    objectType: row.objectType as RecommendationTargetDto['objectType'],
    objectId: row.objectId,
    // Читаемое имя уже вшито в заголовок; отдельный запрос за ним не нужен.
    label: row.title,
  }
}

/** Единственный мэппер рекомендации в DTO. Переиспользуется дашбордом. */
export function toRecommendationDto(row: repo.RecommendationRow): RecommendationDto {
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
    target: toTarget(row),
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
  // Представитель вуза рекомендаций не видит (решение 9).
  assertCan(user, 'ANALYTICS')
  const { rows, total } = await repo.findMany(query, universityScope(user))
  return {
    data: rows.map(toRecommendationDto),
    meta: pageMeta({ page: query.page, pageSize: query.pageSize }, total),
  }
}

export async function getById(user: CurrentUser, id: string): Promise<RecommendationDto> {
  assertCan(user, 'ANALYTICS')
  const row = await repo.findById(id)
  if (!row) throw notFound('Рекомендация не найдена')
  return toRecommendationDto(row)
}

const LEVEL_ORDER: Record<SkillLevel, number> = { BASIC: 1, INTERMEDIATE: 2, ADVANCED: 3 }

/**
 * Прогоняет все правила и сохраняет результат.
 *
 * Рекомендации пересобираются целиком: те, что правила больше не выдают, закрываются.
 * Решения сотрудника (принято, отклонено) при этом не переписываются.
 */
export async function generate(user: CurrentUser): Promise<RecommendationGenerationResultDto> {
  assertCan(user, 'WRITE')

  const now = new Date()
  const input = await repo.loadGenerationInput(now)
  const drafts: RecommendationDraft[] = []

  // ── Правила по связкам ─────────────────────────────────────────────────────
  for (const cooperation of input.cooperations) {
    let hasOverdueDraft = false

    for (const stage of cooperation.stages) {
      if (!stage.deadline) continue
      if (!isOverdue(stage.deadline, stage.status, now)) continue

      const draft = ruleOverdueStage(
        {
          cooperationId: cooperation.id,
          universityName: cooperation.university.name,
          programName: cooperation.program.name,
          stageNumber: stage.stageNumber,
          stageTitle: stage.title,
          status: stage.status,
          deadline: stage.deadline,
          responsibleName: stage.responsible?.fullName ?? null,
        },
        now,
      )
      // Достаточно одной рекомендации о просрочке на связку: самый ранний просроченный этап.
      if (draft) {
        drafts.push(draft)
        hasOverdueDraft = true
        break
      }
    }

    const current = findCurrentStage(cooperation.stages)
    if (!current) continue

    // Просрочка уже говорит «займитесь этой связкой». Добавлять поверх неё «связка
    // без движения» — шум: сотрудник получит два пункта об одной и той же проблеме.
    if (!hasOverdueDraft) {
      const stalled = ruleStalledCooperation(
        {
          cooperationId: cooperation.id,
          universityName: cooperation.university.name,
          programName: cooperation.program.name,
          stageNumber: current.stageNumber,
          stageTitle: current.title,
          stageStatus: current.status,
          updatedAt: cooperation.updatedAt,
        },
        now,
      )
      if (stalled) drafts.push(stalled)
    }

    const withoutProduct = ruleCooperationWithoutProduct({
      cooperationId: cooperation.id,
      universityName: cooperation.university.name,
      programName: cooperation.program.name,
      currentStageNumber: current.stageNumber,
      hasProduct: cooperation.productId !== null,
    })
    if (withoutProduct) drafts.push(withoutProduct)
  }

  // ── Правило по недостающим показателям программ ────────────────────────────
  for (const program of input.programs) {
    const draft = ruleMissingProgramMetrics({
      programId: program.id,
      programName: program.name,
      universityName: program.university.name,
      applicationCount: program.applicationCount,
      studentCount: program.studentCount,
      groupCount: program.groupCount,
      hasCooperation: program._count.cooperations > 0,
    })
    if (draft) drafts.push(draft)
  }

  // ── Правило по критичным дефицитам навыков ─────────────────────────────────
  const normalizeValue = demandNormalizer(input.demand.map((row) => row.value))

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
  for (const row of input.demand) {
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
  drafts.push(...gapDrafts.slice(0, RECOMMENDATION_RULES.criticalGapLimit))

  // ── Сохранение ─────────────────────────────────────────────────────────────
  const { created, updated, keys } = await repo.upsertDrafts(drafts)
  const closed = await repo.closeObsolete(keys)

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

export async function updateStatus(
  user: CurrentUser,
  id: string,
  input: UpdateRecommendationInput,
): Promise<RecommendationDto> {
  assertCan(user, 'WRITE')

  const existing = await repo.findById(id)
  if (!existing) throw notFound('Рекомендация не найдена')

  const row = await repo.updateStatus(id, input.status, user.id, input.comment ?? null)

  await writeAudit({
    userId: user.id,
    action: 'recommendation.status.change',
    objectType: 'Recommendation',
    objectId: id,
    payload: { from: existing.status, to: input.status, ruleKey: existing.ruleKey },
  })

  return toRecommendationDto(row)
}
