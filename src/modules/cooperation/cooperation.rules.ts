import { conflict, validationError } from '@/shared/http/errors'
import { WORKFLOW_STAGES } from '@/shared/config/workflow.config'
import { addDays } from '@/shared/utils/date'
import type { CooperationStatus } from '@/shared/contracts/enums'
import { COOPERATION_STATUS_LABELS } from '@/shared/contracts/labels'

export interface NewStageData {
  stageNumber: number
  title: string
  phase: 'ATTRACTION' | 'FORMALIZATION' | 'IMPLEMENTATION' | 'OPERATION' | 'CONTROL'
  deadline: Date
  responsibleId: string
  tasks: Array<{ title: string; isRequired: boolean; isUniversityItem: boolean; sortOrder: number }>
}

/**
 * Полный набор из 14 этапов для новой связки: все создаются сразу.
 * Сроки считаются от даты старта по нормативам из shared/config/workflow.config.ts.
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
      // Пункт вуза (решение 103): кто его отмечает, решает признак, а не заголовок.
      isUniversityItem: task.universityItem === true,
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
 * не может повлиять. По этим статусам работают и генератор рекомендаций,
 * и выборки просроченных, заблокированных и проблемных этапов.
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
 * Проверить только, что статус передан, мало: передав закрытой связке её же текущий
 * статус, можно было бы менять остальные поля в обход запрета.
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

/** Незакрытая связка с тем же «вуз + программа + IT-продукт». */
export interface DuplicateCooperation {
  id: string
  status: CooperationStatus
  universityName: string
  programName: string
}

/**
 * Одна незакрытая связка на «вуз + программа + IT-продукт» (продукт «не выбран» —
 * тоже значение). Вторая такая же делит с первой этапы, документы и встречи:
 * работа расползается по двум карточкам, прогресс и просрочки считаются дважды.
 * Закрытые не мешают — сотрудничество можно начать заново после завершения.
 */
export function assertNoDuplicateCooperation(duplicate: DuplicateCooperation | null): void {
  if (!duplicate) return
  throw conflict(
    `Такая связка уже есть: ${duplicate.universityName} — ${duplicate.programName}, ` +
      `статус «${COOPERATION_STATUS_LABELS[duplicate.status]}»`,
    { cooperationId: duplicate.id },
  )
}
