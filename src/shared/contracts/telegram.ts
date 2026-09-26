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
  /** Ник в Telegram без @, если он есть, — к какому чату Telegram привязано сейчас. */
  username: string | null
  linkedAt: string | null
}

/**
 * POST /api/me/telegram: ссылка на бота с одноразовым токеном привязки.
 *
 * Работает и при уже существующей привязке — тогда это «Перепривязать» (решение 142):
 * человек открывает ту же ссылку в другом чате Telegram, `/start` переносит
 * привязку на новый чат, а в прежний уходит одно сообщение о переносе.
 */
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

// ─────────────────────── Админка бота (решение 142) ────────────────────────────

/** Откуда действующий токен: из базы (администратор задавал в админке), из env, или бота вовсе нет. */
export type TelegramTokenSourceDto = 'database' | 'env' | 'none'

/** Что сейчас реально принимает обновления — не путать с настроенным режимом (`mode`). */
export type TelegramRunningModeDto = 'webhook' | 'polling' | 'off'

/**
 * GET /api/admin/telegram (только ADMIN): полная картина состояния бота —
 * для «Настройки → Интеграции».
 */
export interface TelegramAdminStatusDto {
  /** Есть и токен, и имя бота, и секрет вебхука. */
  configured: boolean
  /** Имя бота без @, если известно. */
  botUsername: string | null
  /** Режим, который выбран (env `TELEGRAM_MODE` или админка): webhook/polling/auto. */
  mode: 'webhook' | 'polling' | 'auto'
  /** Что происходит фактически прямо сейчас. */
  running: TelegramRunningModeDto
  /** Адрес вебхука у Telegram; пустая строка — вебхук не назначен (например, идёт polling). */
  webhookUrl: string | null
  /** Необработанных вебхуком обновлений по данным Telegram; null — не удалось узнать. */
  pendingUpdateCount: number | null
  lastErrorMessage: string | null
  /** Когда была последняя ошибка вебхука (ISO 8601); null — ошибок не было или неизвестно. */
  lastErrorAt: string | null
  /** Сколько сотрудников подключили личные уведомления. */
  linkedEmployeeCount: number
  tokenSource: TelegramTokenSourceDto
  /** Задан ли TELEGRAM_OWNER_CHAT_ID — оповещения владельцу дойдут и без привязки администратора. */
  ownerChatConfigured: boolean
}

/** PUT /api/admin/telegram/token — тело запроса. Токен от @BotFather, целиком. */
export interface TelegramSetTokenDto {
  token: string
}

/** PUT /api/admin/telegram/mode — тело запроса. */
export interface TelegramSetModeDto {
  mode: 'webhook' | 'polling' | 'auto'
}

/** POST /api/admin/telegram/test: кому ушло проверочное сообщение. */
export interface TelegramTestSentDto {
  /** 'admin' — в чат администратора, который нажал кнопку; 'owner' — в TELEGRAM_OWNER_CHAT_ID. */
  sentTo: 'admin' | 'owner'
}
