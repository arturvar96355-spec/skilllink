/**
 * Хук старта сервера Next (решение 123): проверка окружения до первого запроса.
 *
 * В промышленном режиме с секретом подписи, который знают все, или без базы
 * процесс завершается с понятной строкой в журнале — лучше упавший контейнер,
 * чем стенд, где сессию может подделать любой. Предупреждения по необязательным
 * настройкам (бот, модель, демо-режим) — строки журнала, старт не прерывают.
 *
 * `next build` этот хук не вызывает; `next dev` и тесты — не промышленный режим.
 * Модуль проверки подключается динамически и только в среде Node: в edge-сборку
 * middleware он не попадает.
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
