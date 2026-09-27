/**
 * Автоматическая пересборка «Списка задач» (решение 212).
 *
 * Кнопки «Пересобрать» в интерфейсе больше нет: список обновляется сам.
 * Смена этапа сверяет задачи своей связки сразу (`syncCooperation`), а всё,
 * что зависит от времени и от других данных — просрочки по календарю, новые
 * связки, показатели программ, дефициты навыков, — догоняет эта функция:
 * при чтении списка или главной, если с последней пересборки прошло больше
 * `maxAgeMs`, правила прогоняются заново, и ответ уже свежий.
 *
 * Время последней пересборки берётся из журнала действий (`recommendation.generate`),
 * поэтому переживает перезапуск сервера и одинаково для нескольких процессов.
 * Одновременные запросы ждут одну и ту же пересборку, а не запускают свою.
 * Сбой пересборки чтение не ломает: пишется в журнал сервера, список отдаётся
 * как есть, следующая попытка — не раньше чем через `retryAfterMs`.
 */
export interface AutoRefreshDeps {
  /** Когда список пересобирался в последний раз; null — ни разу. */
  lastRunAt: () => Promise<Date | null>
  /** Прогнать правила и сохранить результат. */
  run: () => Promise<unknown>
  now?: () => Date
  /** Старше — пересобрать перед чтением. */
  maxAgeMs: number
  /** После сбоя не пробовать снова раньше, чем через столько. */
  retryAfterMs?: number
  onError?: (error: unknown) => void
}

export function createAutoRefresh(deps: AutoRefreshDeps): () => Promise<void> {
  const now = deps.now ?? (() => new Date())
  const retryAfterMs = deps.retryAfterMs ?? deps.maxAgeMs
  let inFlight: Promise<void> | null = null
  // Пока база говорит «свежо», повторно её не спрашиваем: известное время
  // последней пересборки держится в памяти процесса.
  let knownFreshUntil = 0

  async function refresh(): Promise<void> {
    try {
      const last = await deps.lastRunAt()
      const at = now().getTime()
      if (last && at - last.getTime() < deps.maxAgeMs) {
        knownFreshUntil = last.getTime() + deps.maxAgeMs
        return
      }
      await deps.run()
      knownFreshUntil = now().getTime() + deps.maxAgeMs
    } catch (error) {
      knownFreshUntil = now().getTime() + retryAfterMs
      deps.onError?.(error)
    }
  }

  return function ensureFresh(): Promise<void> {
    if (now().getTime() < knownFreshUntil) return Promise.resolve()
    if (!inFlight) {
      inFlight = refresh().finally(() => {
        inFlight = null
      })
    }
    return inFlight
  }
}
