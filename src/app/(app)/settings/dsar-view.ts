import {
  DSAR_REQUEST_CHANNEL_LABELS,
  DSAR_REQUEST_KIND_LABELS,
  DSAR_SUBJECT_TYPE_LABELS,
  type DsarRequestDto,
} from '@/shared/contracts'
import { formatDate } from '@/ui/lib/format'

/**
 * Реестр запросов субъектов ПД (решение 116, экран — решение 181): подписи
 * и короткие фразы для строки списка.
 *
 * Чистые функции без React — проверяются тестом (dsar-view.test.ts).
 */

/** Заголовок строки: вид запроса и тип субъекта. */
export function dsarRequestTitle(request: DsarRequestDto): string {
  return `${DSAR_REQUEST_KIND_LABELS[request.kind]} · ${DSAR_SUBJECT_TYPE_LABELS[request.subjectType]}`
}

/** Срок ответа: у открытого — до какой даты (или «просрочен»), у исполненного — когда закрыт. */
export function dsarDueCaption(request: DsarRequestDto): string {
  if (request.status === 'COMPLETED') {
    return `Исполнен ${formatDate(request.completedAt)}`
  }
  return request.overdue ? `Просрочен — срок был ${formatDate(request.dueAt)}` : `Срок до ${formatDate(request.dueAt)}`
}

/** Канал регистрации — словами, для подстрочника карточки запроса. */
export function dsarChannelCaption(request: DsarRequestDto): string {
  return DSAR_REQUEST_CHANNEL_LABELS[request.channel]
}

/**
 * Что ввести в поле подтверждения при обезличивании: сервер сверяет его
 * с почтой для входа пользователя или ФИО контакта (dsar.service.ts, `confirmMatches`).
 */
export function dsarConfirmHint(subjectType: DsarRequestDto['subjectType']): string {
  return subjectType === 'USER'
    ? 'Введите рабочую почту для входа обезличиваемого пользователя'
    : 'Введите ФИО обезличиваемого контакта, как оно записано в карточке вуза'
}
