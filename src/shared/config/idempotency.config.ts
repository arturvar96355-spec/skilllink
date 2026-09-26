/**
 * Ключи идемпотентности POST-созданий (решение 123).
 */
export const IDEMPOTENCY = {
  /** Сколько живёт ключ: повтор двойного щелчка или обрыва сети — минуты, сутки с запасом. */
  ttlMs: 24 * 3600_000,
  /** Ключ — строка клиента (обычно UUID). Длиннее — отказ. */
  maxKeyLength: 255,
  /** Сохранённый ответ больше этого не храним — отвечаем как обычно, без повтора. */
  maxStoredResponseBytes: 256 * 1024,
} as const

/** Заголовок ключа. */
export const IDEMPOTENCY_HEADER = 'idempotency-key'
/** Заголовок ответа-повтора: ответ взят из сохранённого, а не выполнен заново. */
export const IDEMPOTENCY_REPLAYED_HEADER = 'idempotency-replayed'
