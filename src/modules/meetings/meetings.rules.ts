import { validationError } from '@/shared/http/errors'

/** Встреча должна быть к чему-то привязана, иначе её не найти в истории (раздел 9.2 ТЗ). */
export function assertHasLink(links: {
  cooperationId?: string | null
  universityId?: string | null
  programId?: string | null
}): void {
  if (!links.cooperationId && !links.universityId && !links.programId) {
    throw validationError('Встреча должна быть привязана к связке, вузу или программе', [
      { field: 'cooperationId', message: 'Укажите хотя бы одну привязку' },
    ])
  }
}

/**
 * Следующее действие без срока — это пожелание, а не задача.
 * Если указано, что делать дальше, должно быть указано и когда.
 */
export function assertNextActionHasDate(
  nextAction: string | null | undefined,
  nextActionDueAt: string | null | undefined,
): void {
  const hasAction = typeof nextAction === 'string' && nextAction.trim().length > 0
  if (hasAction && !nextActionDueAt) {
    throw validationError('У следующего действия должен быть срок', [
      { field: 'nextActionDueAt', message: 'Укажите, к какой дате нужно выполнить действие' },
    ])
  }
}
