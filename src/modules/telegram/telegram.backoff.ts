/**
 * Пауза перед повторной попыткой `getUpdates` при сбое связи (решение 192).
 *
 * Экспоненциальный рост с разбросом: 1 с → 2 → 4 … до потолка в 60 с. Разброс ±20% —
 * чтобы при одновременном сбое (например, обрыве сети у хостера) повторные попытки
 * не били по Bot API синхронной пачкой. Чистая функция — раунд-трипа в сеть или
 * таймера внутри нет, поэтому проверяется обычным vitest без фейковых таймеров.
 */

export const BACKOFF_MIN_MS = 1_000
export const BACKOFF_MAX_MS = 60_000
/** Доля от базовой паузы, на которую может отклонить разброс — в обе стороны. */
const JITTER_RATIO = 0.2

/**
 * @param failureStreak сколько подряд неуспешных попыток, считая текущую (1 — первая после сбоя).
 * @param random источник случайности в [0; 1) — подменяется в тестах для детерминизма.
 */
export function computeBackoffDelayMs(failureStreak: number, random: () => number = Math.random): number {
  const streak = Math.max(1, Math.floor(failureStreak))
  const base = Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * 2 ** (streak - 1))
  const jitter = base * JITTER_RATIO * (random() * 2 - 1)
  const withJitter = Math.round(base + jitter)
  return Math.min(BACKOFF_MAX_MS, Math.max(BACKOFF_MIN_MS, withJitter))
}
