/**
 * Сквозной номер запроса `x-request-id` (решение 133).
 *
 * Middleware принимает номер от прокси или клиента, если он похож на номер,
 * иначе выдаёт свой; кладёт его в заголовки запроса (его читает обработчик
 * маршрута и журнал) и ответа (его видит человек и может назвать в поддержке).
 * Ответ 500 несёт тот же номер в теле — по нему находится строка журнала.
 *
 * Только веб-API: файл импортирует middleware, а он работает в edge-среде.
 */

export const REQUEST_ID_HEADER = 'x-request-id'

/** Не длиннее 64 знаков, только латиница, цифры и дефис: в журнал не попадёт ни перевод строки, ни разметка. */
const VALID_REQUEST_ID = /^[A-Za-z0-9-]{1,64}$/

export function isValidRequestId(value: string | null | undefined): value is string {
  return typeof value === 'string' && VALID_REQUEST_ID.test(value)
}

export function createRequestId(): string {
  return crypto.randomUUID()
}

/** Присланный номер, если он допустим, иначе новый. */
export function resolveRequestId(incoming: string | null | undefined): string {
  return isValidRequestId(incoming) ? incoming : createRequestId()
}
