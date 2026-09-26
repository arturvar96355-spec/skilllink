import { assertCan } from '@/shared/auth/permissions'
import { writeAudit } from '@/shared/audit/audit'
import { notFound } from '@/shared/http/errors'
import { STAGE_PHASE_LABELS } from '@/shared/contracts/labels'
import type { CurrentUser } from '@/shared/auth/current-user'
import type {
  WorkflowSettingsDto,
  WorkflowStageTemplateDto,
  WorkflowStageTemplatePatchResultDto,
} from '@/shared/contracts/settings'
import { CONTROL_STAGE_NUMBER } from '@/shared/config/workflow.config'
import { toIsoRequired } from '@/shared/utils/date'
import * as repo from './workflow-templates.repo'
import type { PatchWorkflowStageTemplateInput } from './workflow-templates.schema'

/**
 * Признак контрольной точки — только чтение (ТЗ, п. 4; решение 146): правила
 * порядка этапов (workflow.rules.ts, CONTROL_POINT_STAGES) проверяют номера 6, 7, 11
 * в коде (решения 5/28, docs/CONTROL_POINTS.md). Снятие признака в настройках
 * молча сломало бы эти правила — этап считался бы контрольным для проверки
 * порядка, но настройки говорили бы обратное. Поэтому это объяснение уходит
 * в каждый пункт списка, а не только в описание PATCH.
 */
function controlPointExplanation(isControlPoint: boolean): string | null {
  if (!isControlPoint) return null
  return (
    'Контрольная точка: этот этап нельзя начать или завершить, пока не закрыто всё, ' +
    'что должно было случиться раньше (решения 5/28, docs/CONTROL_POINTS.md). ' +
    'Признак задан в коде и через настройки не меняется — можно поменять только ' +
    'название и нормативный срок.'
  )
}

function toDto(row: repo.WorkflowStageTemplateRow): WorkflowStageTemplateDto {
  const defaultTasks = Array.isArray(row.defaultTasks)
    ? (row.defaultTasks as Array<{ title: string; isRequired: boolean; isUniversityItem?: boolean }>)
    : []
  return {
    stageNumber: row.stageNumber,
    title: row.title,
    phase: row.phase,
    phaseLabel: STAGE_PHASE_LABELS[row.phase],
    normativeDays: row.normativeDays,
    isControlPoint: row.isControlPoint,
    controlPointExplanation: controlPointExplanation(row.isControlPoint),
    defaultTasks: defaultTasks.map((task) => ({
      title: task.title,
      isRequired: task.isRequired,
      isUniversityItem: task.isUniversityItem === true,
    })),
    updatedAt: toIsoRequired(row.updatedAt),
    updatedBy: row.updatedBy,
  }
}

/** `GET /api/settings/workflow` — только ADMIN (ТЗ, п. 4; решение 146). */
export async function getSettings(user: CurrentUser): Promise<WorkflowSettingsDto> {
  assertCan(user, 'ADMIN')
  const rows = await repo.findAll()
  return { stages: rows.map(toDto) }
}

/**
 * `PATCH /api/settings/workflow/stages/:number` — переименовать этап и/или
 * изменить нормативный срок. Новые связки сразу получают новое значение
 * (cooperation.rules.ts, buildStages); существующие — только с явным
 * `applyToUnfinishedStages: true` (ТЗ, п. 4: «существующие не меняются»,
 * если админ не попросил иначе).
 */
export async function patchStage(
  user: CurrentUser,
  stageNumber: number,
  input: PatchWorkflowStageTemplateInput,
): Promise<WorkflowStageTemplatePatchResultDto> {
  assertCan(user, 'ADMIN')

  const existing = await repo.findByNumber(stageNumber)
  if (!existing) {
    throw notFound(
      stageNumber > CONTROL_STAGE_NUMBER || stageNumber < 1
        ? 'Номер этапа от 1 до 14'
        : 'Шаблон этапа не найден — таблица не заполнена сидом (npm run db:seed)',
    )
  }

  const changedFields: string[] = []
  if (input.title !== undefined && input.title !== existing.title) changedFields.push('title')
  if (input.normativeDays !== undefined && input.normativeDays !== existing.normativeDays) {
    changedFields.push('normativeDays')
  }

  const row =
    changedFields.length > 0
      ? await repo.update(stageNumber, {
          title: input.title,
          normativeDays: input.normativeDays,
          updatedById: user.id,
        })
      : existing

  let appliedToStages = 0
  if (changedFields.length > 0 && input.applyToUnfinishedStages) {
    appliedToStages = await repo.applyToUnfinishedStages(stageNumber, {
      title: input.title,
      normativeDays: input.normativeDays,
    })
  }

  if (changedFields.length > 0) {
    await writeAudit({
      userId: user.id,
      action: 'workflow_template.update',
      objectType: 'WorkflowStageTemplate',
      objectId: row.id,
      payload: { stageNumber, fields: changedFields, appliedToStages },
    })
  }

  return { ...toDto(row), appliedToStages }
}
