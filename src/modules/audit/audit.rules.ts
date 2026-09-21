import { DOCUMENT_STATUS_LABELS } from '@/modules/documents/documents.rules'
import { STATUS_LABELS as STAGE_STATUS_LABELS } from '@/modules/workflow/workflow.rules'
import type { DocumentStatus, StageStatus } from '@/shared/contracts/enums'

/**
 * Формулировки событий ленты вуза.
 *
 * Лента читается человеком, поэтому статусы переводятся в слова, а не показываются кодами.
 * Подписи берутся из тех же словарей, что и остальная система, — дублировать их нельзя.
 */

export function stageEventTitle(
  stageNumber: number,
  stageTitle: string,
  toStatus: StageStatus,
): string {
  switch (toStatus) {
    case 'COMPLETED':
      return `Этап ${stageNumber} «${stageTitle}» завершён`
    case 'IN_PROGRESS':
      return `Этап ${stageNumber} «${stageTitle}» в работе`
    case 'BLOCKED':
      return `Этап ${stageNumber} «${stageTitle}» заблокирован`
    case 'CANCELLED':
      return `Этап ${stageNumber} «${stageTitle}» отменён`
    default:
      return `Этап ${stageNumber} «${stageTitle}»: ${STAGE_STATUS_LABELS[toStatus]}`
  }
}

export function documentEventTitle(
  title: string,
  version: string,
  toStatus: DocumentStatus,
): string {
  const name = `«${title}» (версия ${version})`
  switch (toStatus) {
    case 'REVIEW':
      return `Документ ${name} отправлен на согласование`
    case 'APPROVED':
      return `Документ ${name} согласован`
    case 'SIGNED':
      return `Документ ${name} подписан`
    case 'REJECTED':
      return `Документ ${name} отклонён`
    case 'ARCHIVED':
      return `Документ ${name} отправлен в архив`
    default:
      return `Документ ${name}: ${DOCUMENT_STATUS_LABELS[toStatus]}`
  }
}

export function applicationEventTitle(quantity: number, programName: string): string {
  return `Подано заявок на обучение: ${quantity} («${programName}»)`
}

export function cooperationEventTitle(
  programName: string,
  productName: string | null,
): string {
  return productName
    ? `Создана связка: «${programName}» и «${productName}»`
    : `Создана связка по программе «${programName}»`
}
