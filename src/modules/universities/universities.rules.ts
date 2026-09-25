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

/** Имя, которое остаётся у обезличенного контакта вместо ФИО. */
export const ANONYMIZED_CONTACT_NAME = 'Контакт удалён'

/**
 * Обезличивание контактного лица вуза — исполнение права субъекта на удаление
 * персональных данных (ст. 14 и 21 152-ФЗ, docs/PRIVACY.md).
 *
 * Запись не удаляется: на неё ссылаются участники встреч, а история работы с вузом
 * должна остаться целой. Удаляются сами персональные данные — ФИО, должность
 * (вместе с вузом она указывает на человека), почта, телефон и заметки.
 * Признак основного снимается: «Контакт удалён» не может быть основным контактом вуза.
 */
export const ANONYMIZED_CONTACT_FIELDS = {
  fullName: ANONYMIZED_CONTACT_NAME,
  position: null,
  email: null,
  phone: null,
  notes: null,
  isPrimary: false,
} as const

/** Контакт уже обезличен: повторное обезличивание ничего не меняет и журнал не засоряет. */
export function isAnonymizedContact(contact: {
  fullName: string
  position: string | null
  email: string | null
  phone: string | null
}): boolean {
  return (
    contact.fullName === ANONYMIZED_CONTACT_NAME &&
    contact.position === null &&
    contact.email === null &&
    contact.phone === null
  )
}

/**
 * Условие выборки «контакт не обезличен» — для мест, где контакт подставляется
 * в новый текст (шаблоны документов): «в лице Контакт удалён» писать нельзя.
 */
export const LIVE_CONTACT_WHERE = { NOT: { fullName: ANONYMIZED_CONTACT_NAME } } as const
