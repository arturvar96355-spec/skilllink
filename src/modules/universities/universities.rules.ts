import { conflict, validationError } from '@/shared/http/errors'
import type {
  ConsentForm,
  ConsentStatus,
  ContactLegalBasis,
  UniversityStatus,
} from '@/shared/contracts/enums'

/**
 * Слитый дубль (решение 134) из архива не возвращается: его программы, связки и контакты
 * у другого вуза. Вернуть можно только отменой слияния.
 */
export function assertNotMerged(mergedIntoId: string | null): void {
  if (mergedIntoId) {
    throw conflict(
      'Вуз слит с другим как дубль. Чтобы вернуть его, отмените слияние: POST /api/universities/merge/:id/undo.',
      { mergedIntoId },
    )
  }
}

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

// ───────────── Правовое основание обработки ПД и согласие (решение 111) ─────────────

/** Состояние учёта основания у контакта — то, что меняют фиксация и отзыв. */
export interface ContactBasisState {
  legalBasis: ContactLegalBasis | null
  consentStatus: ConsentStatus
  consentObtainedAt: Date | null
  consentForm: ConsentForm | null
  consentWithdrawnAt: Date | null
  basisReference: string | null
  withdrawalReference: string | null
}

/** Контакт целиком, как его видят правила: состояние учёта и поля, по которым он обезличен. */
export type ContactForBasis = ContactBasisState & {
  fullName: string
  position: string | null
  email: string | null
  phone: string | null
}

/** Запись истории без контакта, автора и времени — их подставляет репозиторий. */
export interface ContactBasisHistoryDraft {
  fromBasis: ContactLegalBasis | null
  toBasis: ContactLegalBasis
  fromConsentStatus: ConsentStatus
  toConsentStatus: ConsentStatus
  consentObtainedAt: Date | null
  consentForm: ConsentForm | null
  consentWithdrawnAt: Date | null
  referenceChanged: boolean
  anonymized: boolean
}

/** Что записать: новые поля контакта и строка истории. */
export interface ContactBasisPlan {
  data: ContactBasisState & { basisUpdatedAt: Date } & Partial<typeof ANONYMIZED_CONTACT_FIELDS>
  history: ContactBasisHistoryDraft
}

export interface SetContactBasisInput {
  basis: ContactLegalBasis
  documentReference: string
  consentObtainedAt?: string | null
  consentForm?: ConsentForm | null
}

export interface WithdrawConsentInput {
  withdrawnAt?: string | undefined
  withdrawalReference: string
}

function sameInstant(left: Date | null, right: Date | null): boolean {
  return (left?.getTime() ?? null) === (right?.getTime() ?? null)
}

/**
 * Фиксация основания: что записать, или null — если ничего не меняется (повтор
 * той же формы не плодит историю и журнал).
 *
 * - Обезличенный контакт — 409: персональных данных нет, основание обрабатывать нечего.
 *   Отозванное согласие — тоже 409: такой контакт уже обезличен, и вернуть согласие
 *   задним числом значило бы переписать историю.
 * - Согласие (п. 1 ч. 1 ст. 6) требует дату получения — не в будущем — и форму
 *   (ч. 1 ст. 9). У остальных оснований дату и форму передавать нельзя: иначе
 *   в карточке появилось бы «согласие получено» при основании «договор».
 * - Уход с согласия на другое основание разрешён — это ч. 2 ст. 9: оператор вправе
 *   обрабатывать без согласия при основаниях п. 2–11. Дата и форма согласия тогда
 *   очищаются в карточке, но остаются в истории.
 */
export function planBasisChange(
  current: ContactForBasis,
  input: SetContactBasisInput,
  now: Date,
): ContactBasisPlan | null {
  if (isAnonymizedContact(current)) {
    throw conflict('Контакт обезличен: персональных данных нет, основание для их обработки не фиксируется.')
  }
  if (current.consentStatus === 'WITHDRAWN') {
    throw conflict('Согласие контакта отозвано — изменить основание нельзя.')
  }

  const isConsent = input.basis === 'CONSENT'
  const obtainedAt = input.consentObtainedAt ? new Date(input.consentObtainedAt) : null

  if (isConsent) {
    const details = []
    if (!obtainedAt) details.push({ field: 'consentObtainedAt', message: 'Укажите дату получения согласия' })
    if (!input.consentForm) details.push({ field: 'consentForm', message: 'Укажите форму согласия' })
    if (obtainedAt && obtainedAt.getTime() > now.getTime()) {
      details.push({ field: 'consentObtainedAt', message: 'Дата получения согласия не может быть в будущем' })
    }
    if (details.length > 0) throw validationError('Не хватает сведений о согласии', details)
  } else if (obtainedAt || input.consentForm) {
    throw validationError('Дата и форма согласия указываются только при основании «согласие»', [
      ...(obtainedAt ? [{ field: 'consentObtainedAt', message: 'Не указывается для этого основания' }] : []),
      ...(input.consentForm ? [{ field: 'consentForm', message: 'Не указывается для этого основания' }] : []),
    ])
  }

  const next: ContactBasisState = {
    legalBasis: input.basis,
    consentStatus: isConsent ? 'OBTAINED' : 'NONE',
    consentObtainedAt: isConsent ? obtainedAt : null,
    consentForm: isConsent ? (input.consentForm ?? null) : null,
    consentWithdrawnAt: null,
    basisReference: input.documentReference,
    withdrawalReference: null,
  }

  const unchanged =
    current.legalBasis === next.legalBasis &&
    current.consentStatus === next.consentStatus &&
    sameInstant(current.consentObtainedAt, next.consentObtainedAt) &&
    current.consentForm === next.consentForm &&
    current.basisReference === next.basisReference
  if (unchanged) return null

  return {
    data: { ...next, basisUpdatedAt: now },
    history: {
      fromBasis: current.legalBasis,
      toBasis: input.basis,
      fromConsentStatus: current.consentStatus,
      toConsentStatus: next.consentStatus,
      consentObtainedAt: next.consentObtainedAt,
      consentForm: next.consentForm,
      consentWithdrawnAt: null,
      referenceChanged: current.basisReference !== next.basisReference,
      anonymized: false,
    },
  }
}

/**
 * Отзыв согласия (ст. 9, ч. 5 ст. 21 152-ФЗ): что записать, или null — если
 * согласие уже отозвано (повтор ничего не меняет).
 *
 * Отзывать можно только действующее согласие, и только когда оно — основание
 * обработки. Если у оператора есть другое основание (ч. 2 ст. 9), его фиксируют
 * до отзыва, и тогда отзыв не нужен: согласие перестаёт быть основанием.
 *
 * Отзыв единственного основания — **немедленное обезличивание** тем же набором
 * полей, что и по запросу субъекта: продолжать обработку не на чем, а 30 дней
 * ч. 5 ст. 21 — предельный срок, а не отсрочка. Документ отзыва обязателен:
 * действие необратимо, и оператору нужно, на что сослаться в акте.
 */
export function planConsentWithdrawal(
  current: ContactForBasis,
  input: WithdrawConsentInput,
  now: Date,
): ContactBasisPlan | null {
  if (current.consentStatus === 'WITHDRAWN') return null
  if (current.legalBasis !== 'CONSENT' || current.consentStatus !== 'OBTAINED') {
    throw conflict(
      current.legalBasis === null
        ? 'Основание обработки контакта не зафиксировано — отзывать нечего.'
        : 'Основание обработки контакта — не согласие, отзывать нечего. ' +
            'Требование субъекта прекратить обработку исполняется обезличиванием контакта.',
    )
  }

  const withdrawnAt = input.withdrawnAt ? new Date(input.withdrawnAt) : now
  if (withdrawnAt.getTime() > now.getTime()) {
    throw validationError('Дата отзыва не может быть в будущем', [
      { field: 'withdrawnAt', message: 'Укажите дату получения отзыва — не позже сегодняшней' },
    ])
  }
  if (current.consentObtainedAt && withdrawnAt.getTime() < current.consentObtainedAt.getTime()) {
    throw validationError('Отзыв не может быть раньше получения согласия', [
      { field: 'withdrawnAt', message: 'Дата отзыва раньше даты получения согласия' },
    ])
  }

  const alreadyAnonymized = isAnonymizedContact(current)
  return {
    data: {
      legalBasis: 'CONSENT',
      consentStatus: 'WITHDRAWN',
      consentObtainedAt: current.consentObtainedAt,
      consentForm: current.consentForm,
      consentWithdrawnAt: withdrawnAt,
      basisReference: current.basisReference,
      withdrawalReference: input.withdrawalReference,
      basisUpdatedAt: now,
      ...(alreadyAnonymized ? {} : ANONYMIZED_CONTACT_FIELDS),
    },
    history: {
      fromBasis: 'CONSENT',
      toBasis: 'CONSENT',
      fromConsentStatus: 'OBTAINED',
      toConsentStatus: 'WITHDRAWN',
      consentObtainedAt: current.consentObtainedAt,
      consentForm: current.consentForm,
      consentWithdrawnAt: withdrawnAt,
      referenceChanged: true,
      anonymized: !alreadyAnonymized,
    },
  }
}

/** Вид записи истории — по переходу статуса согласия. */
export function basisHistoryKind(entry: {
  fromConsentStatus: ConsentStatus
  toConsentStatus: ConsentStatus
}): 'basis.set' | 'consent.withdraw' {
  return entry.fromConsentStatus !== 'WITHDRAWN' && entry.toConsentStatus === 'WITHDRAWN'
    ? 'consent.withdraw'
    : 'basis.set'
}
