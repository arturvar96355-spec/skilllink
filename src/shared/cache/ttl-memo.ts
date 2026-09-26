/**
 * Кеш с истечением по времени, с ключом на область видимости (решение 190,
 * ревью базы) — тот же приём, что `sharedInsights` в `pulse.extras.ts` (решение
 * 120), только не привязан к одному месту: несколько тяжёлых, но не критичных
 * к секундной свежести запросов (аналитика, поиск домена письма, редакция
 * ПД перед ИИ) кешируются одним и тем же кодом вместо копии одной и той же
 * логики памяти в каждом модуле.
 *
 * Сбой не запоминается: следующий вызов посчитает заново, а не повторит ошибку
 * весь остаток срока жизни записи.
 */
export function createTtlMemo<K, V>(ttlMs: number) {
  let entry: { key: K; at: number; value: Promise<V> } | null = null

  return function memo(key: K, now: Date, compute: () => Promise<V>): Promise<V> {
    if (!entry || entry.key !== key || now.getTime() - entry.at > ttlMs) {
      const value = compute()
      entry = { key, at: now.getTime(), value }
      value.catch(() => {
        if (entry?.value === value) entry = null
      })
    }
    return entry.value
  }
}
