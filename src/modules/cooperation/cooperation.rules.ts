import { conflict, validationError } from '@/shared/http/errors'
import { WORKFLOW_STAGES } from '@/shared/config/workflow.config'
import { addDays } from '@/shared/utils/date'
import type { CooperationStatus } from '@/shared/contracts/enums'

export interface NewStageData {
  stageNumber: number
  title: string
  phase: 'ATTRACTION' | 'FORMALIZATION' | 'IMPLEMENTATION' | 'OPERATION' | 'CONTROL'
  deadline: Date
  responsibleId: string
  tasks: Array<{ title: string; isRequired: boolean; sortOrder: number }>
}

/**
 * Полный набор из 14 этапов для новой связки (решение 2).
 * Сроки считаются от даты старта по нормативам из shared/config — все они TEMP.
 */
export function buildStages(startedAt: Date, responsibleId: string): NewStageData[] {
  return WORKFLOW_STAGES.map((definition) => ({
    stageNumber: definition.number,
    title: definition.title,
    phase: definition.phase,
    deadline: addDays(startedAt, definition.normativeDays),
    responsibleId,
    tasks: definition.tasks.map((task, index) => ({
      title: task.title,
      isRequired: task.isRequired,
      sortOrder: index,
    })),
  }))
}

/** Программа должна принадлежать выбранному вузу, иначе связка бессмысленна. */
export function assertProgramBelongsToUniversity(
  programUniversityId: string,
  universityId: string,
): void {
  if (programUniversityId !== universityId) {
    throw validationError('Программа принадлежит другому вузу', [
      { field: 'programId', message: 'Выберите программу выбранного вуза' },
    ])
  }
}

export function assertCooperationEditable(status: CooperationStatus): void {
  if (status === 'COMPLETED' || status === 'CANCELLED') {
    throw conflict('Связка закрыта: изменения недоступны', { status })
  }
}
