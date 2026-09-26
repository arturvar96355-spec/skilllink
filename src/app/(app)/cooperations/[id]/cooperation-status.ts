import type { CooperationStatus } from '@/shared/contracts'

/**
 * Смена статуса связки (задача «Данные без экрана», пункт 1).
 *
 * Закрытые статусы дублируют `isClosedStatus` из серверного `cooperation.rules.ts`:
 * серверные правила фронту не импортируются (`src/generated/prisma` и `@/modules`
 * запрещены на фронте), а этот список нужен только для текста предупреждения —
 * решение всё равно принимает сервер, его отказ показывается как есть.
 */
export const CLOSED_COOPERATION_STATUSES: readonly CooperationStatus[] = ['COMPLETED', 'CANCELLED']

export function isClosedCooperationStatus(status: CooperationStatus): boolean {
  return CLOSED_COOPERATION_STATUSES.includes(status)
}

/** Что произойдёт — по тому, что реально делает `cooperation.service.ts` при смене статуса. */
export function cooperationStatusConsequence(current: CooperationStatus, next: CooperationStatus): string {
  const wasClosed = isClosedCooperationStatus(current)
  const willBeClosed = isClosedCooperationStatus(next)
  if (willBeClosed && !wasClosed) {
    return 'Связка закроется: этапы, документы и встречи останутся, но менять ход работы по этапам будет нельзя. Вернуть связку в работу можно в любой момент — сменой статуса обратно.'
  }
  if (wasClosed && !willBeClosed) {
    return 'Связка вернётся в работу: этапы снова можно вести дальше.'
  }
  return 'Смена статуса попадёт в журнал действий.'
}
