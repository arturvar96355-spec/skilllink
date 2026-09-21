import { conflict, invalidTransition, validationError } from '@/shared/http/errors'
import type { DocumentStatus } from '@/shared/contracts/enums'

/**
 * Жизненный цикл документа (раздел 9.1 ТЗ).
 *
 * Подписанный документ не редактируется и не возвращается в работу: правка подписанного
 * документа — это новая версия, а не изменение старой. Иначе теряется смысл подписи.
 */
export const ALLOWED_DOCUMENT_TRANSITIONS: Record<DocumentStatus, readonly DocumentStatus[]> = {
  DRAFT: ['REVIEW', 'ARCHIVED'],
  REVIEW: ['APPROVED', 'REJECTED', 'DRAFT', 'ARCHIVED'],
  APPROVED: ['SIGNED', 'REVIEW', 'ARCHIVED'],
  SIGNED: ['ARCHIVED'],
  REJECTED: ['DRAFT', 'ARCHIVED'],
  ARCHIVED: [],
}

export const DOCUMENT_STATUS_LABELS: Record<DocumentStatus, string> = {
  DRAFT: 'Черновик',
  REVIEW: 'На согласовании',
  APPROVED: 'Согласован',
  SIGNED: 'Подписан',
  REJECTED: 'Отклонён',
  ARCHIVED: 'В архиве',
}

function isFilled(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

export interface DocumentState {
  status: DocumentStatus
  fileReference: string | null
}

export interface DocumentTransitionRequest {
  toStatus: DocumentStatus
  comment?: string | null
}

export function assertDocumentTransition(
  document: DocumentState,
  request: DocumentTransitionRequest,
): void {
  const from = document.status
  const to = request.toStatus

  if (from === to) {
    throw invalidTransition(`Документ уже в статусе «${DOCUMENT_STATUS_LABELS[to]}»`, { from, to })
  }

  if (!ALLOWED_DOCUMENT_TRANSITIONS[from].includes(to)) {
    throw invalidTransition(
      `Недопустимый переход документа: «${DOCUMENT_STATUS_LABELS[from]}» → «${DOCUMENT_STATUS_LABELS[to]}»`,
      { from, to, allowed: ALLOWED_DOCUMENT_TRANSITIONS[from] },
    )
  }

  // Отклонение и возврат на доработку требуют основания: без него автор не поймёт, что править.
  if ((to === 'REJECTED' || (from === 'REVIEW' && to === 'DRAFT')) && !isFilled(request.comment)) {
    throw validationError('Нужен комментарий с основанием', [
      { field: 'comment', message: 'Укажите, что нужно исправить' },
    ])
  }

  // Согласовывать нечего, пока нет самого документа.
  if (to === 'REVIEW' && !isFilled(document.fileReference)) {
    throw validationError('Нельзя отправить на согласование документ без ссылки на файл', [
      { field: 'fileReference', message: 'Добавьте ссылку на документ' },
    ])
  }
}

/** Подписанный документ правкам не подлежит — только новая версия. */
export function assertDocumentEditable(status: DocumentStatus): void {
  if (status === 'SIGNED' || status === 'ARCHIVED') {
    throw conflict(
      `Документ в статусе «${DOCUMENT_STATUS_LABELS[status]}» не редактируется. Создайте новую версию.`,
      { status },
    )
  }
}

/** Документ обязан быть к чему-то привязан, иначе его невозможно найти (раздел 9.1 ТЗ). */
export function assertHasLink(links: {
  cooperationId?: string | null
  universityId?: string | null
  programId?: string | null
}): void {
  if (!links.cooperationId && !links.universityId && !links.programId) {
    throw validationError('Документ должен быть привязан к связке, вузу или программе', [
      { field: 'cooperationId', message: 'Укажите хотя бы одну привязку' },
    ])
  }
}

/**
 * Следующий номер версии.
 * Версии числовые и растут на единицу: «1» → «2». Нечисловая версия наращивается суффиксом,
 * чтобы не потерять исходное обозначение вуза (например, «Приложение А» → «Приложение А.2»).
 */
export function nextVersion(current: string): string {
  const asNumber = Number(current)
  if (Number.isInteger(asNumber) && asNumber > 0) return String(asNumber + 1)

  const match = current.match(/^(.*)\.(\d+)$/)
  if (match && match[1] && match[2]) return `${match[1]}.${Number(match[2]) + 1}`

  return `${current}.2`
}
