/**
 * Личные уведомления в Telegram (решение 102): блок «Уведомления в Telegram»
 * в личном кабинете.
 */

/** GET /api/me/telegram и ответ DELETE. */
export interface TelegramStatusDto {
  /** Бот настроен администратором. false — блок пишет «Не настроено администратором», кнопок нет. */
  configured: boolean
  /**
   * Сводка доступна роли пользователя: сотрудникам ИТ-Школы. Представителю вуза —
   * нет: сводка собрана из аналитики и рекомендаций, которых в его кабинете нет.
   */
  available: boolean
  linked: boolean
  /** Ник в Telegram без @, если он есть, — чтобы человек узнал свой аккаунт. */
  username: string | null
  linkedAt: string | null
}

/** POST /api/me/telegram: ссылка на бота с одноразовым токеном привязки. */
export interface TelegramConnectDto {
  /** https://t.me/<бот>?start=<токен>. Открывать в новой вкладке или в приложении Telegram. */
  url: string
  /** Когда ссылка перестанет работать (ISO 8601). */
  expiresAt: string
}

/**
 * POST /api/admin/telegram/rotate-webhook-secret (решение 133): секрет вебхука сменён.
 * Самого секрета в ответе нет — его знает только Telegram, у нас хранится хеш.
 */
export interface TelegramWebhookSecretRotatedDto {
  rotatedAt: string
  /** Адрес, на который Telegram теперь шлёт обновления. */
  webhookUrl: string
}
