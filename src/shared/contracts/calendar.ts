/**
 * Подписка на календарь сроков и встреч (.ics, решение 105).
 *
 * Ссылка на ленту — это доступ: кто её знает, видит сроки и встречи владельца
 * без входа. Поэтому сам адрес отдаётся только один раз — в ответе на выпуск,
 * а статус подписки его не содержит.
 */

/** `GET /api/me/calendar` — есть ли у пользователя действующая ссылка. */
export interface CalendarFeedStatusDto {
  active: boolean
  /** Когда выпущена действующая ссылка; null — ссылки нет. */
  createdAt: string | null
}

/** `POST /api/me/calendar` — новая ссылка. Показывается один раз. */
export interface IssuedCalendarFeedDto {
  /** Адрес ленты для «Подписаться по URL» (Google, Яндекс, Outlook). */
  url: string
  /** Тот же адрес со схемой webcal:// — открывает подписку в Apple Календаре и Outlook. */
  webcalUrl: string
  createdAt: string
  /** true — прежняя ссылка перестала работать. */
  replaced: boolean
}

/** `DELETE /api/me/calendar`. */
export interface RevokedCalendarFeedDto {
  /** false — действующей ссылки и не было. */
  revoked: boolean
}
