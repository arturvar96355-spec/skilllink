/**
 * Нормативы каналов уведомлений: MAX и VK (решение 144). Telegram по-прежнему
 * живёт по своим нормативам в telegram.config.ts.
 */

/** Токен привязки чата к пользователю — как TELEGRAM_LINK, свой на MAX и VK. */
export const CHANNEL_LINK = {
  /** Сколько живёт ссылка/код привязки. */
  ttlMs: 15 * 60_000,
  /** Предел использованных кодов в памяти процесса. */
  maxRemembered: 1000,
} as const

/** Вебхук MAX и Callback API VK: одно событие — это килобайты. */
export const CHANNEL_WEBHOOK = {
  maxBodyBytes: 256 * 1024,
  /** Сколько суток помнить обработанный update_id/event_id (channel_updates_seen). */
  seenRetentionDays: 7,
  /** Старые отметки чистятся при каждой N-й вставке — без отдельного расписания. */
  purgeEveryInserts: 100,
} as const
