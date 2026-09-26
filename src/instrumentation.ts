/**
 * Хук старта сервера Next (решение 133, приём без вебхука — решение 142).
 *
 * В промышленном режиме с секретом подписи, который знают все, или без базы
 * процесс завершается с понятной строкой в журнале — лучше упавший контейнер,
 * чем стенд, где сессию может подделать любой. Предупреждения по необязательным
 * настройкам (бот, модель, демо-режим) — строки журнала, старт не прерывают.
 *
 * После проверки окружения — единственная фоновая задача внутри процесса
 * (решение 118 говорило «фоновых задач нет»; polling Telegram — исключение,
 * заведённое здесь же): при `TELEGRAM_MODE=polling` сразу цикл `getUpdates`,
 * при `auto` (по умолчанию) — проверка раз в 5 минут, готовая переключиться
 * с вебхука на polling сама (`modules/telegram/telegram.runtime.ts`). Без токена
 * (ни в env, ни в базе) — ничего не запускается, как и раньше.
 *
 * `next build` этот хук не вызывает; `next dev` и тесты — не промышленный режим,
 * а `shouldCheckEnvironment` их и отсекает — значит, ни один из этих путей не
 * трогает настоящий Bot API.
 * Модули подключаются динамически и только в среде Node: в edge-сборку
 * middleware они не попадают.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  const { checkEnvironment, shouldCheckEnvironment } = await import('@/shared/config/env')
  if (!shouldCheckEnvironment(process.env)) return

  const { log } = await import('@/shared/log/logger')
  const report = checkEnvironment(process.env)
  for (const warning of report.warnings) log.warn('[env] предупреждение настройки', { problem: warning })
  if (report.errors.length > 0) {
    for (const error of report.errors) log.error('[env] сервер не запущен: ошибка настройки', { problem: error })
    log.error('[env] исправьте переменные окружения (docs/DEPLOY.md) и перезапустите сервер')
    process.exit(1)
  }

  await startTelegramRuntime(log)
}

interface Logger {
  info: (msg: string, fields?: Record<string, unknown>) => void
  warn: (msg: string, fields?: Record<string, unknown>) => void
  error: (msg: string, fields?: Record<string, unknown>) => void
}

/**
 * Поднять приём обновлений Telegram, если бот настроен (решение 142). Токен
 * может быть в базе (администратор задал его в админке до этого перезапуска) —
 * поэтому сначала `loadRuntimeOverrides`, и только потом проверка `enabled`.
 *
 * SIGTERM/SIGINT: сам процесс не завершаем (это по-прежнему делает Next —
 * решение 118, «Next сам ловит SIGTERM»), только останавливаем цикл polling —
 * без этого он держал бы открытый long-poll запрос к Telegram до его собственного
 * таймаута, и контейнер жил бы до `stop_grace_period`, а не выходил сам.
 */
async function startTelegramRuntime(log: Logger): Promise<void> {
  const { resolveSecret } = await import('@/shared/auth/auth')
  const { loadRuntimeOverrides, effectiveTelegramConfig } = await import('@/integrations/telegram/runtime-config')
  const secret = resolveSecret()
  await loadRuntimeOverrides(secret)

  const config = effectiveTelegramConfig()
  if (!config.enabled) return

  const runtime = await import('@/modules/telegram/telegram.runtime')
  await runtime.start(secret)
  log.info('[telegram] приём обновлений запущен', { mode: config.mode })

  let shuttingDown = false
  const shutdown = (): void => {
    if (shuttingDown) return
    shuttingDown = true
    runtime.stop().catch((error: unknown) => log.error('[telegram] остановка не выполнена', { err: error }))
  }
  process.once('SIGTERM', shutdown)
  process.once('SIGINT', shutdown)
}
