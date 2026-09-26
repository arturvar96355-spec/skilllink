import { log } from '@/shared/log/logger'

/**
 * Запускает приём обновлений Telegram без вебхука (решение 142) при первом
 * запросе к серверу — не в `instrumentation.ts`.
 *
 * Next компилирует `instrumentation.ts` и для Node.js, и для edge-времени
 * middleware (в проекте есть `middleware.ts`), а рантайм бота
 * (`modules/telegram/telegram.runtime.ts`) тянет Prisma (`pg`, нужен `fs`/`path`/
 * `stream` для SSL-сертификатов) — она не собирается для edge. `next build`
 * падал на этом уже на этапе построения графа зависимостей, до отбрасывания
 * мёртвого кода проверкой `NEXT_RUNTIME`: она решает, что делать в исполнении,
 * а не что бандлить при сборке, и `serverExternalPackages` (`next.config.ts`),
 * которая обычно решает похожие проблемы с `pg` для обычных маршрутов, на
 * `instrumentation.ts` не распространяется.
 *
 * `ensureTelegramRuntimeStarted()` зовётся из `shared/http/handle.ts` — общей
 * обёртки всех API-маршрутов: у нас нет для нужд бота второй, edge-цели сборки,
 * поэтому Prisma собирается так же нормально, как для любого другого маршрута.
 * Функция ничего не ждёт и не бросает — сбой запуска не должен задерживать или
 * ронять обычный запрос, из которого она случайно оказалась вызвана первой.
 */

let started = false

export function ensureTelegramRuntimeStarted(): void {
  if (started) return
  started = true
  if (process.env.NODE_ENV !== 'production') return
  void bootstrap().catch((error: unknown) => log.error('[telegram] запуск приёма обновлений не выполнен', { err: error }))
}

async function bootstrap(): Promise<void> {
  const { resolveSecret } = await import('@/shared/auth/secret')
  const { loadRuntimeOverrides, effectiveTelegramConfig } = await import('@/integrations/telegram/runtime-config')
  const secret = resolveSecret()
  await loadRuntimeOverrides(secret)

  const config = effectiveTelegramConfig()
  if (!config.enabled) return

  const runtime = await import('@/modules/telegram/telegram.runtime')
  await runtime.start(secret)
  log.info('[telegram] приём обновлений запущен', { mode: config.mode })

  // SIGTERM/SIGINT: сам процесс не завершаем (это по-прежнему делает Next —
  // решение 118, «Next сам ловит SIGTERM»), только останавливаем цикл polling —
  // без этого он держал бы открытый long-poll запрос к Telegram до его
  // собственного таймаута, и контейнер жил бы до `stop_grace_period`, а не
  // выходил сам.
  let shuttingDown = false
  const shutdown = (): void => {
    if (shuttingDown) return
    shuttingDown = true
    runtime.stop().catch((error: unknown) => log.error('[telegram] остановка не выполнена', { err: error }))
  }
  process.once('SIGTERM', shutdown)
  process.once('SIGINT', shutdown)
}

/** Только для тестов: разрешить повторный запуск в том же процессе. */
export function resetTelegramBootstrapForTests(): void {
  started = false
}
