import { createHash } from 'node:crypto'
import { AI_ASSIST_LIMITS } from '@/shared/config/ai-assist.config'
import type { AiDraftSource } from '@/shared/contracts/ai-assist'

/**
 * Защита счёта в облаке: лимит обращений к модели на пользователя и короткий
 * кэш одинаковых запросов.
 *
 * Состояние живёт в памяти процесса — так же, как счётчики перебора пароля
 * (`shared/auth/throttle.ts`): у каждого экземпляра приложения свой счётчик,
 * перезапуск его обнуляет. Для одного стенда этого достаточно; ограничение
 * описано в docs/SECURITY_LIMITATIONS.md.
 */

// ── Лимит на пользователя ────────────────────────────────────────────────────

/** Моменты обращений к модели внутри окна — скользящее окно. */
const callsByUser = new Map<string, number[]>()

function recentCalls(userId: string, now: number): number[] {
  return (callsByUser.get(userId) ?? []).filter((at) => now - at < AI_ASSIST_LIMITS.windowMs)
}

/**
 * Забирает одно обращение из лимита. `false` — лимит исчерпан, модель не вызывается.
 *
 * Проверка и запись идут подряд, без `await` между ними: иначе десять
 * одновременных нажатий прошли бы проверку все разом.
 */
export function takeGeneration(userId: string, now = Date.now()): boolean {
  const calls = recentCalls(userId, now)
  if (calls.length >= AI_ASSIST_LIMITS.generationsPerWindow) {
    callsByUser.set(userId, calls)
    return false
  }

  callsByUser.delete(userId)
  // Как у входа: при переполнении убираются самые давно не менявшиеся записи.
  while (callsByUser.size >= AI_ASSIST_LIMITS.maxTrackedUsers) {
    const oldest = callsByUser.keys().next().value
    if (oldest === undefined) break
    callsByUser.delete(oldest)
  }
  callsByUser.set(userId, [...calls, now])
  return true
}

/** Сколько обращений осталось в текущем окне — для тестов и журнала. */
export function generationsLeft(userId: string, now = Date.now()): number {
  return Math.max(0, AI_ASSIST_LIMITS.generationsPerWindow - recentCalls(userId, now).length)
}

// ── Кэш ответов модели ───────────────────────────────────────────────────────

export interface CachedDraft {
  text: string
  source: Exclude<AiDraftSource, 'template'>
  model: string
}

const cache = new Map<string, CachedDraft & { expiresAt: number }>()

/**
 * Ключ кэша — хэш того, что уходит в модель: провайдер, модель, инструкция и факты.
 * Факты меняются — меняется ключ: «просрочен на 57 дн.» завтра станет «на 58 дн.»,
 * и старый текст не вернётся. Кэшируются только ответы модели: шаблон дешевле
 * собрать заново, чем хранить.
 */
export function cacheKey(parts: readonly string[]): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex')
}

export function readCache(key: string, now = Date.now()): CachedDraft | null {
  const entry = cache.get(key)
  if (!entry) return null
  if (entry.expiresAt <= now) {
    cache.delete(key)
    return null
  }
  return { text: entry.text, source: entry.source, model: entry.model }
}

export function writeCache(key: string, draft: CachedDraft, now = Date.now()): void {
  cache.delete(key)
  while (cache.size >= AI_ASSIST_LIMITS.cacheMaxEntries) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }
  cache.set(key, { ...draft, expiresAt: now + AI_ASSIST_LIMITS.cacheTtlMs })
}

/** Только для тестов: состояние процесса между ними протекать не должно. */
export function resetAiAssistLimits(): void {
  callsByUser.clear()
  cache.clear()
}
