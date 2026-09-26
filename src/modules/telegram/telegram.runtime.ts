import { TelegramClient, type TelegramWebhookInfo } from '@/integrations/telegram'
import { effectiveTelegramConfig, TELEGRAM_MODE_SECRET_NAME } from '@/integrations/telegram/runtime-config'
import { writeAudit } from '@/shared/audit/audit'
import { notifyOwner } from '@/shared/ops/owner-alert'
import { log } from '@/shared/log/logger'
import * as service from './telegram.service'
import { telegramUpdateSchema } from './telegram.schema'

/**
 * Приём обновлений без вебхука — long polling (решение 142).
 *
 * `TELEGRAM_MODE=polling` (или выбор в админке): процесс сам держит цикл
 * `getUpdates`, обрабатывая обновления тем же кодом, что и вебхук
 * (`service.acceptUpdate` + `service.handleUpdate` — дедупликация через
 * `telegram_updates_seen` общая для обоих путей). `TELEGRAM_MODE=auto`
 * (по умолчанию): цикл не запущен, пока вебхук отвечает; раз в 5 минут
 * проверяется `getWebhookInfo`, и если последняя ошибка свежее 10 минут или
 * необработанных обновлений становится больше — процесс сам переключается на
 * polling (журнал `telegram.mode_switched`, оповещение владельцу). Обратно на
 * вебхук auto-режим не переключает сам: это решение администратора (после
 * починки сети он ставит `webhook` или снова `auto` в админке).
 *
 * **Один экземпляр приложения.** И цикл polling, и таймер auto-проверки живут
 * в памяти одного процесса. Второй экземпляр (несколько реплик за балансировщиком)
 * запустил бы второй цикл `getUpdates` — Bot API отдаёt каждое обновление только
 * одному из конкурентных вызовов, а не дублирует, но какой из процессов его
 * получит — не определено, и `telegram_updates_seen` тогда не столько дедуплицирует,
 * сколько маскирует гонку. На стенде (один контейнер приложения) это не проблема;
 * при переходе на несколько экземпляров нужен либо один выделенный процесс-приёмник,
 * либо возврат к вебхуку.
 */

const POLL_TIMEOUT_SEC = 25
/** Локальный таймаут запроса — с запасом поверх long-poll timeout (см. TelegramClient.getUpdates). */
const AUTO_CHECK_INTERVAL_MS = 5 * 60_000
const AUTO_ERROR_FRESH_MS = 10 * 60_000
/** Бот выключен (нет токена) — не колотимся в Bot API, просто ждём. */
const DISABLED_RETRY_MS = 5_000
/** Сбой цикла (не сам Telegram, а наш код) — короткая пауза перед следующей попыткой. */
const LOOP_ERROR_RETRY_MS = 2_000

export type TelegramRunningMode = 'webhook' | 'polling' | 'off'

export interface TelegramRuntimeStatus {
  /**
   * Что сейчас реально принимает обновления: `polling` — цикл `getUpdates` работает,
   * `webhook` — цикла нет (пассивный вебхук либо auto ещё не решил переключаться),
   * `off` — бот не настроен.
   */
  running: TelegramRunningMode
  startedAt: Date | null
  lastPollAt: Date | null
  lastPollError: string | null
  lastAutoCheckAt: Date | null
  lastWebhookInfo: TelegramWebhookInfo | null
}

function initialStatus(): TelegramRuntimeStatus {
  return {
    running: 'off',
    startedAt: null,
    lastPollAt: null,
    lastPollError: null,
    lastAutoCheckAt: null,
    lastWebhookInfo: null,
  }
}

let status: TelegramRuntimeStatus = initialStatus()
let stopped = true
let abortController: AbortController | null = null
let loopPromise: Promise<void> | null = null
let autoTimer: ReturnType<typeof setInterval> | null = null
let previousPendingCount: number | null = null
let runtimeSecret: string | null = null

/** Снимок состояния — для админки (GET /api/admin/telegram). */
export function getRuntimeStatus(): TelegramRuntimeStatus {
  return status
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        resolve()
      },
      { once: true },
    )
  })
}

/** Один запрос `getUpdates` и обработка пришедших обновлений. Возвращает следующий offset. */
async function pollTick(client: TelegramClient, offset: number | null, signal: AbortSignal): Promise<number | null> {
  const result = await client.getUpdates({ offset: offset ?? undefined, timeoutSec: POLL_TIMEOUT_SEC, signal })
  if (!result.ok) {
    if (result.reason !== 'aborted') {
      status.lastPollError = result.description ?? `HTTP ${result.status ?? '?'}`
      log.warn('[telegram] polling: getUpdates не выполнен', { reason: result.reason, status: result.status })
    }
    return offset
  }
  status.lastPollError = null
  status.lastPollAt = new Date()

  let nextOffset = offset
  for (const raw of result.updates) {
    const rawId = (raw as { update_id?: unknown }).update_id
    if (typeof rawId === 'number') nextOffset = rawId + 1
    const parsed = telegramUpdateSchema.safeParse(raw)
    if (!parsed.success) {
      log.warn('[telegram] polling: обновление неизвестного вида пропущено')
      continue
    }
    // Тот же код и та же дедупликация (telegram_updates_seen), что у вебхука:
    // переключение режима на полпути не должно ни терять, ни повторять обновления.
    if (await service.acceptUpdate(parsed.data.update_id)) {
      await service.handleUpdate(parsed.data, { secret: runtimeSecret ?? '' })
    }
  }
  return nextOffset
}

async function runPollLoop(): Promise<void> {
  let offset: number | null = null
  status.running = 'polling'
  status.startedAt = new Date()
  try {
    while (!stopped) {
      const config = effectiveTelegramConfig()
      if (!config.enabled) {
        await sleep(DISABLED_RETRY_MS, abortController?.signal)
        continue
      }
      abortController = new AbortController()
      const client = new TelegramClient(config)
      try {
        offset = await pollTick(client, offset, abortController.signal)
      } catch (error) {
        status.lastPollError = error instanceof Error ? error.message : 'неизвестная ошибка'
        log.error('[telegram] polling: сбой цикла', { err: error })
        await sleep(LOOP_ERROR_RETRY_MS)
      }
    }
  } finally {
    status.running = 'off'
  }
}

/** Запустить цикл polling, если он ещё не идёт: снимает вебхук и стартует `runPollLoop`. */
export async function startPollingLoop(secret: string): Promise<void> {
  if (loopPromise) return
  stopped = false
  runtimeSecret = secret
  const config = effectiveTelegramConfig()
  const client = new TelegramClient(config)
  const deleted = await client.deleteWebhook()
  if (!deleted.ok && deleted.reason !== 'disabled') {
    log.warn('[telegram] polling: deleteWebhook не выполнен — вебхук мог остаться активным', {
      status: deleted.status,
    })
  }
  loopPromise = runPollLoop()
}

/** Остановить цикл polling (не трогает auto-таймер). Ждёт, пока текущая попытка выйдет. */
export async function stopPollingLoop(): Promise<void> {
  if (!loopPromise) return
  stopped = true
  abortController?.abort()
  await loopPromise.catch((error: unknown) => log.error('[telegram] polling: цикл завершился с ошибкой', { err: error }))
  loopPromise = null
  abortController = null
}

// ── auto-режим ────────────────────────────────────────────────────────────────

async function switchToPollingAutomatically(secret: string, reason: string): Promise<void> {
  log.warn('[telegram] auto: переключение на приём без вебхука (polling)', { reason })
  await writeAudit({
    userId: null,
    action: 'telegram.mode_switched',
    objectType: 'SystemSecret',
    objectId: TELEGRAM_MODE_SECRET_NAME,
    payload: { by: 'auto', to: 'polling', reason },
  })
  notifyOwner('telegram.auto-switched-to-polling', { details: { reason } })
  await startPollingLoop(secret)
}

/**
 * Одна проверка auto-режима: свежая ошибка вебхука или растущее число
 * необработанных обновлений — сигнал, что Telegram не достукивается до сервера
 * (решение 133: `last_error_message: Connection timed out` на стенде). Ничего не
 * решаем по одиночному ненулевому `pending_update_count` — сравниваем с прошлой
 * проверкой, иначе разовый всплеск (например, сразу после простоя) включал бы
 * polling без нужды.
 */
export async function checkAutoMode(secret: string): Promise<void> {
  const config = effectiveTelegramConfig()
  status.lastAutoCheckAt = new Date()
  if (config.mode !== 'auto' || !config.enabled || loopPromise) return

  const client = new TelegramClient(config)
  const result = await client.getWebhookInfo()
  if (!result.ok) return // не смогли узнать — не паникуем, подождём следующей проверки
  status.lastWebhookInfo = result.info

  const now = Date.now()
  const errorFresh = result.info.lastErrorDate !== null && now - result.info.lastErrorDate.getTime() < AUTO_ERROR_FRESH_MS
  const pendingGrowing = previousPendingCount !== null && result.info.pendingUpdateCount > previousPendingCount
  previousPendingCount = result.info.pendingUpdateCount
  if (!errorFresh && !pendingGrowing) return

  const reason = errorFresh
    ? `последняя ошибка вебхука свежее 10 минут: ${result.info.lastErrorMessage ?? 'без описания'}`
    : `необработанных обновлений становится больше (сейчас ${result.info.pendingUpdateCount})`
  await switchToPollingAutomatically(secret, reason)
}

// ── Запуск и остановка процесса (instrumentation.ts) ───────────────────────────

/**
 * Решить начальный режим и запустить фоновую часть (называется один раз при
 * старте сервера, только в промышленном режиме и только если есть токен —
 * решение о том, когда звать, принимает `instrumentation.ts`).
 */
export async function start(secret: string): Promise<void> {
  const config = effectiveTelegramConfig()
  if (!config.enabled) return
  runtimeSecret = secret

  if (config.mode === 'polling') {
    await startPollingLoop(secret)
    return
  }
  if (config.mode === 'auto') {
    await checkAutoMode(secret) // сразу же, не только через 5 минут
    autoTimer = setInterval(() => {
      checkAutoMode(secret).catch((error: unknown) => log.error('[telegram] auto: проверка не выполнена', { err: error }))
    }, AUTO_CHECK_INTERVAL_MS)
  }
  // mode === 'webhook': ни цикла, ни таймера — вебхук работает сам по себе.
}

/** Аккуратная остановка (SIGTERM, решение 118): дожидается текущей попытки цикла. */
export async function stop(): Promise<void> {
  if (autoTimer) {
    clearInterval(autoTimer)
    autoTimer = null
  }
  await stopPollingLoop()
}

/** Только для тестов: сбросить состояние модуля между прогонами. */
export function resetRuntimeForTests(): void {
  status = initialStatus()
  stopped = true
  abortController = null
  loopPromise = null
  if (autoTimer) clearInterval(autoTimer)
  autoTimer = null
  previousPendingCount = null
  runtimeSecret = null
}
