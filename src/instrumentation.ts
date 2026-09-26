/**
 * Хук старта сервера Next (решение 133): проверка окружения до первого запроса.
 *
 * В промышленном режиме с секретом подписи, который знают все, или без базы
 * процесс завершается с понятной строкой в журнале — лучше упавший контейнер,
 * чем стенд, где сессию может подделать любой. Предупреждения по необязательным
 * настройкам (бот, модель, демо-режим) — строки журнала, старт не прерывают.
 *
 * `next build` этот хук не вызывает; `next dev` и тесты — не промышленный режим.
 * Модуль проверки подключается динамически и только в среде Node: в edge-сборку
 * middleware он не попадает.
 *
 * Запуск приёма Telegram без вебхука (решение 142, `TELEGRAM_MODE=polling|auto`)
 * заведён **не здесь**, а в `shared/http/handle.ts` (`ensureTelegramRuntimeStarted`,
 * `shared/ops/telegram-bootstrap.ts): Next компилирует `instrumentation.ts` и для
 * Node.js, и для edge-времени middleware (в проекте есть `middleware.ts`), а
 * телеграм-рантайм тянет Prisma (`pg`, нужен `fs`/`path`/`stream` для SSL) —
 * она не собирается для edge, и `next build` падал на этом уже на этапе
 * построения графа зависимостей, до отбрасывания мёртвого кода проверкой
 * `NEXT_RUNTIME` (она решает, что делать в runtime, а не что бандлить при сборке;
 * `serverExternalPackages` в `next.config.ts`, которая обычно решает такие
 * проблемы с `pg`, на этот отдельный вход не распространяется). `handle()` —
 * обычная обёртка API-маршрутов, у неё нет второй edge-цели, и там Prisma
 * собирается так же нормально, как во всех остальных маршрутах.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  const { checkEnvironment, shouldCheckEnvironment } = await import('@/shared/config/env')
  if (!shouldCheckEnvironment(process.env)) return

  const { log } = await import('@/shared/log/logger')
  const report = checkEnvironment(process.env)
  for (const warning of report.warnings) log.warn('[env] предупреждение настройки', { problem: warning })
  if (report.errors.length === 0) return

  for (const error of report.errors) log.error('[env] сервер не запущен: ошибка настройки', { problem: error })
  log.error('[env] исправьте переменные окружения (docs/DEPLOY.md) и перезапустите сервер')
  process.exit(1)
}
