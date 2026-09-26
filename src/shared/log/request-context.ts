import { AsyncLocalStorage } from 'node:async_hooks'

/**
 * Номер текущего запроса для журнала (решение 133). Обработчик маршрута
 * (`handle()`) запускает работу внутри `runWithRequestId`, и любой вызов
 * журнала глубже — в сервисе, репозитории, клиенте интеграции — получает номер
 * без передачи параметром. Вне запроса (скрипты, тесты) номера нет.
 */
const storage = new AsyncLocalStorage<{ requestId: string }>()

export function runWithRequestId<T>(requestId: string, fn: () => T): T {
  return storage.run({ requestId }, fn)
}

export function currentRequestId(): string | null {
  return storage.getStore()?.requestId ?? null
}
