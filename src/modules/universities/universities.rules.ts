import { conflict } from '@/shared/http/errors'
import type { UniversityStatus } from '@/shared/contracts/enums'

/** Статусы, при которых вуз считается «в работе» (показатель дашборда 7.1). */
export const ACTIVE_UNIVERSITY_STATUSES: readonly UniversityStatus[] = ['IN_PROGRESS', 'ACTIVE']

/**
 * Архивировать вуз с незакрытыми связями нельзя: иначе связка повиснет
 * на записи, которой в реестре уже нет.
 */
export function assertCanArchive(openCooperations: number): void {
  if (openCooperations > 0) {
    throw conflict(
      `Нельзя архивировать вуз: есть незакрытые связи (${openCooperations}). Закройте или отмените их.`,
      { openCooperations },
    )
  }
}

export function assertNotArchived(archivedAt: Date | null): void {
  if (archivedAt) {
    throw conflict('Запись в архиве. Восстановите её, чтобы вносить изменения.')
  }
}
