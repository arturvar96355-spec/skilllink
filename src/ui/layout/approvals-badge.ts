import type { ApprovalListMetaDto } from '@/shared/contracts'

/**
 * Число у пункта «Согласования» (решение 218) — без React, проверяется тестом.
 *
 * Дела, которые ждут именно этого администратора: чужие запросы без решения
 * и свои согласованные, которые осталось выполнить. Ноль — числа нет вовсе.
 */
export function approvalsCount(meta: Pick<ApprovalListMetaDto, 'awaiting' | 'readyToRun'> | null): number | undefined {
  if (!meta || typeof meta.awaiting !== 'number') return undefined
  const total = meta.awaiting + (meta.readyToRun ?? 0)
  return total > 0 ? total : undefined
}

/** Событие окна: на экране «Согласований» что-то решили — число у пункта пора перечитать. */
export const APPROVALS_CHANGED_EVENT = 'skilllink:approvals-changed'

export function notifyApprovalsChanged(): void {
  window.dispatchEvent(new Event(APPROVALS_CHANGED_EVENT))
}

/** Число у пункта меню словами для чтения с экрана: «Согласования, 2 ждут вас». */
export function countBadgeText(count: number): string {
  return count > 99 ? '99+' : String(count)
}
