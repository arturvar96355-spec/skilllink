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

export function isClosedStatus(status: CooperationStatus): boolean {
  return status === 'COMPLETED' || status === 'CANCELLED'
}

/**
 * Статусы связок, по которым система продолжает работать.
 *
 * Закрытая связка не порождает проблем: её этапы заморожены, трогать их нельзя,
 * и требовать по ним действий значит наполнять дашборд тем, на что никто
 * не может повлиять. Генератор рекомендаций всегда работал только по этим
 * статусам — теперь то же правило действует и для просроченных, заблокированных
 * и проблемных этапов.
 */
export { OPEN_COOPERATION_STATUSES } from '@/shared/contracts/enums'

/**
 * Процесс закрытой связки заморожен: этапы не двигаются, чек-листы не меняются,
 * пакет документов не собирается.
 *
 * Граница проведена по смыслу: workflow — это состояние процесса, и у завершённой
 * или отменённой связки его менять нельзя. А документы и встречи — записи о том, что
 * произошло; занести акт о расторжении или протокол последней встречи задним числом
 * нужно уметь и после закрытия.
 */
export function assertCooperationOpen(status: CooperationStatus): void {
  if (isClosedStatus(status)) {
    throw conflict(
      'Связка закрыта: работа по этапам недоступна. Переоткройте связку, чтобы продолжить.',
      { status },
    )
  }
}

/**
 * Закрытую связку можно только переоткрыть.
 *
 * Проверять достаточно ли того, что статус передан, было нельзя: передав закрытой связке
 * её же текущий статус, можно было менять остальные поля в обход запрета.
 */
export function assertCooperationEditable(
  current: CooperationStatus,
  next: CooperationStatus | undefined,
): void {
  if (!isClosedStatus(current)) return

  const target = next ?? current
  if (!isClosedStatus(target)) return

  throw conflict(
    'Связка закрыта: её можно только переоткрыть, изменив статус на действующий',
    { status: current },
  )
}
