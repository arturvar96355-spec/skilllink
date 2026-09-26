import { assertCan, can } from '@/shared/auth/permissions'
import type { CurrentUser } from '@/shared/auth/current-user'
import { writeAudit } from '@/shared/audit/audit'
import { randomBytes } from 'node:crypto'
import { TELEGRAM_DIGEST, TELEGRAM_WEBHOOK, TELEGRAM_WEBHOOK_SECRET_NAME } from '@/shared/config/telegram.config'
import type {
  TelegramConnectDto,
  TelegramStatusDto,
  TelegramWebhookSecretRotatedDto,
} from '@/shared/contracts/telegram'
import { forbidden, integrationError } from '@/shared/http/errors'
import { addDays } from '@/shared/utils/date'
import { getIntegrationsConfig, type TelegramConfig } from '@/integrations/config'
import { TelegramClient } from '@/integrations/telegram'
import { pulseSourcesFor } from '@/modules/analytics/pulse.service'
import * as repo from './telegram.repo'
import {
  consumeLinkToken,
  createLinkToken,
  matchesWebhookSecretHash,
  webhookSecretHash,
} from './telegram.link-token'
import { BOT_REPLIES, buildDigest, parseCommand, type Digest } from './telegram.rules'
import type { TelegramUpdate } from './telegram.schema'
import { log } from '@/shared/log/logger'

/**
 * Личные уведомления в Telegram (решение 102): «что горит у меня» — менеджеру
 * в личку.
 *
 * По умолчанию выключены: без TELEGRAM_BOT_TOKEN, TELEGRAM_BOT_USERNAME и
 * TELEGRAM_WEBHOOK_SECRET профиль пишет «Не настроено администратором», вебхук
 * ничего не делает, рассылка ничего не шлёт — приложение живёт как раньше.
 *
 * Что горит, решают правила этапов и рекомендаций; модуль только собирает их
 * в текст (`telegram.rules.ts`). Сбой Telegram не становится ошибкой запроса.
 */

function telegramConfig(): TelegramConfig {
  return getIntegrationsConfig().telegram
}

/**
 * Публичный адрес стенда для ссылок в сводке: AUTH_URL (адрес за прокси, его видит
 * человек), иначе APP_BASE_URL. Ни того ни другого — сводка без ссылок.
 */
function publicBaseUrl(): string | null {
  const raw = process.env.AUTH_URL?.trim() || process.env.APP_BASE_URL?.trim() || ''
  try {
    return raw ? new URL(raw).origin : null
  } catch {
    return null
  }
}

// ─────────────────────────── Личный кабинет ─────────────────────────────────

/** Состояние блока «Уведомления в Telegram». Любая роль — о себе. */
export async function getStatus(user: CurrentUser): Promise<TelegramStatusDto> {
  assertCan(user, 'READ')
  const link = await repo.findLinkByUser(user.id)
  return {
    configured: telegramConfig().enabled,
    available: can(user, 'ANALYTICS'),
    linked: link !== null,
    username: link?.username ?? null,
    linkedAt: link?.linkedAt.toISOString() ?? null,
  }
}

/**
 * Ссылка «Подключить»: t.me/<бот>?start=<токен>. Токен ничего не хранит в базе —
 * привязка появится, только когда человек нажмёт «Старт» в Telegram.
 * `secret` — секрет сессий (AUTH_SECRET): его передаёт маршрут, чтобы модуль
 * не тянул за собой NextAuth и работал в скрипте рассылки.
 */
export function connect(user: CurrentUser, secret: string, now = Date.now()): TelegramConnectDto {
  assertCan(user, 'ANALYTICS')
  const config = telegramConfig()
  if (!config.enabled || !config.botUsername) {
    throw integrationError('Уведомления в Telegram не настроены администратором')
  }
  const { token, expiresAt } = createLinkToken(secret, user.id, now)
  return {
    url: `https://t.me/${encodeURIComponent(config.botUsername)}?start=${token}`,
    expiresAt: expiresAt.toISOString(),
  }
}

/**
 * Отключить из личного кабинета. Работает и при выключенном боте: убрать свои
 * данные человек может всегда. Повтор — не ошибка.
 */
export async function disconnect(user: CurrentUser): Promise<TelegramStatusDto> {
  assertCan(user, 'READ')
  if (await repo.unlinkUser(user.id)) {
    await writeAudit({
      userId: user.id,
      action: 'telegram.unlink',
      objectType: 'User',
      objectId: user.id,
      payload: { source: 'profile' },
    })
  }
  return getStatus(user)
}

// ─────────────────────────────── Сводка ─────────────────────────────────────

/**
 * Сводка «что горит у меня» — текст пульса (решение 120): этапы связок пользователя,
 * открытые рекомендации по ним и расширения пульса. Право — как у рекомендаций
 * (аналитика): представителю вуза сводки нет.
 */
export async function digestFor(user: CurrentUser, now = new Date()): Promise<Digest> {
  return buildDigest(await pulseSourcesFor(user, now), { now, baseUrl: publicBaseUrl() })
}

export interface DigestRunSummary {
  recipients: number
  sent: number
  /** Ничего не горит — сообщение по расписанию не отправлялось. */
  empty: number
  /** Роль больше не видит сводку (например, стал представителем вуза). */
  skipped: number
  /** Человек остановил бота в Telegram. */
  blocked: number
  failed: number
}

/**
 * Рассылка сводки всем привязанным активным пользователям (`npm run telegram:digest`).
 * Пустые сводки не отправляются: сообщение «ничего не горит» каждое утро
 * быстро приучает сообщения не читать. С `dryRun` — только печать.
 */
export async function sendDigests(options: {
  dryRun: boolean
  client?: TelegramClient
  now?: Date
  print?: (line: string) => void
  wait?: (ms: number) => Promise<void>
}): Promise<DigestRunSummary> {
  const client = options.client ?? new TelegramClient(telegramConfig())
  const now = options.now ?? new Date()
  const print = options.print ?? ((line: string) => console.log(line))
  const wait = options.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const summary: DigestRunSummary = { recipients: 0, sent: 0, empty: 0, skipped: 0, blocked: 0, failed: 0 }

  let cursor: string | null = null
  for (;;) {
    const batch = await repo.listActiveLinks(cursor, TELEGRAM_DIGEST.batchSize)
    if (batch.length === 0) break
    cursor = batch.at(-1)!.id

    for (const recipient of batch) {
      summary.recipients += 1
      if (!can(recipient.user, 'ANALYTICS')) {
        summary.skipped += 1
        continue
      }
      let digest: Digest
      try {
        digest = await digestFor(recipient.user, now)
      } catch (error) {
        // Сводка одного человека не останавливает рассылку остальным.
        log.error('[telegram] сводка не собрана', { userId: recipient.user.id, err: error })
        summary.failed += 1
        continue
      }
      if (digest.isEmpty) {
        summary.empty += 1
        continue
      }
      if (options.dryRun) {
        // Без почты, ФИО и чата: в журнал cron уходит только id и сама сводка.
        print(`── пользователь ${recipient.user.id}\n${digest.text}\n`)
        summary.sent += 1
        continue
      }
      const result = await client.sendMessage(recipient.chatId, digest.text)
      if (result.ok) summary.sent += 1
      else if (result.reason === 'blocked') summary.blocked += 1
      else summary.failed += 1
      await wait(TELEGRAM_DIGEST.sendIntervalMs)
    }
  }
  return summary
}

// ─────────────────────────────── Вебхук ─────────────────────────────────────

/**
 * SHA-256 действующего секрета вебхука. Сменённый администратором (system_secrets,
 * решение 133) главнее TELEGRAM_WEBHOOK_SECRET: переменная окружения статична,
 * а после смены Telegram присылает уже новый секрет. Ни того ни другого — null,
 * вебхук закрыт для всех.
 */
async function currentWebhookSecretHash(): Promise<string | null> {
  const stored = await repo.findSecretHash(TELEGRAM_WEBHOOK_SECRET_NAME)
  if (stored) return stored
  const fromEnv = telegramConfig().webhookSecret
  return fromEnv ? webhookSecretHash(fromEnv) : null
}

/** Без верного секрета — 403 до чтения тела. */
export async function assertWebhookSecret(received: string | null): Promise<void> {
  // Заголовка нет — в базу не ходим: так отвечают все посторонние запросы.
  if (received === null || !matchesWebhookSecretHash(received, await currentWebhookSecretHash())) {
    throw forbidden('Запрос не от Telegram')
  }
}

/** Вставок отметок с момента последней чистки — чистим раз в N вставок. */
let insertsSincePurge = 0

/**
 * Принять обновление к выполнению: true — впервые, false — повтор (решение 133).
 *
 * Отметка — в базе (telegram_updates_seen), а не в памяти: Telegram повторяет
 * обновление, не дождавшись ответа, и повтор после перезапуска процесса больше
 * не выполняется второй раз («Готово: подключено» дважды, две сводки подряд).
 * Сбой базы — исключение: маршрут ответит 500, и Telegram повторит позже,
 * когда будет где отметить.
 */
export async function acceptUpdate(updateId: number, now = new Date()): Promise<boolean> {
  const first = await repo.markUpdateSeen(updateId)
  insertsSincePurge += 1
  if (insertsSincePurge >= TELEGRAM_WEBHOOK.purgeEveryInserts) {
    insertsSincePurge = 0
    try {
      await repo.purgeSeenUpdates(addDays(now, -TELEGRAM_WEBHOOK.seenRetentionDays))
    } catch (error) {
      log.warn('[telegram] старые отметки обновлений не удалены', { err: error })
    }
  }
  return first
}

/** Только для тестов. */
export function resetSeenUpdates(): void {
  insertsSincePurge = 0
}

// ─────────────────────── Смена секрета вебхука (решение 133) ───────────────────────

/** Одна смена за раз: две одновременные оставили бы в базе не тот секрет, что у Telegram. */
let rotation: Promise<unknown> = Promise.resolve()

function webhookUrl(): string | null {
  const base = publicBaseUrl()
  return base ? `${base}/api/telegram/webhook` : null
}

/**
 * Новый секрет вебхука. Порядок важен: СНАЧАЛА setWebhook у Telegram, и только при
 * успехе — запись SHA-256 в базу. Наоборот нельзя: при отказе Telegram база уже
 * ждала бы новый секрет, а Telegram слал бы старый — вебхук встал бы. В короткое
 * окно между ответом Telegram и записью обновления с новым секретом получают 403,
 * и Telegram их повторяет.
 *
 * Сам секрет не возвращается и не пишется никуда, кроме запроса к Telegram:
 * проверке входящих нужен только его хеш.
 */
export async function rotateWebhookSecret(
  user: CurrentUser,
  options: { client?: TelegramClient; now?: Date } = {},
): Promise<TelegramWebhookSecretRotatedDto> {
  assertCan(user, 'ADMIN')
  const run = rotation.then(async () => {
    const config = telegramConfig()
    if (!config.enabled) throw integrationError('Бот Telegram не настроен: задайте токен, имя бота и секрет вебхука')
    const url = webhookUrl()
    if (!url) throw integrationError('Не задан публичный адрес стенда (AUTH_URL или APP_BASE_URL) — некуда направить вебхук')

    const secret = randomBytes(32).toString('base64url')
    const client = options.client ?? new TelegramClient(config)
    const result = await client.setWebhook(url, secret)
    if (!result.ok) {
      throw integrationError('Telegram не принял новый секрет — прежний продолжает действовать', {
        telegramStatus: result.status,
      })
    }

    const rotatedAt = await repo.saveSecretHash(TELEGRAM_WEBHOOK_SECRET_NAME, webhookSecretHash(secret), user.id)
    await writeAudit({
      userId: user.id,
      action: 'telegram.webhook_secret_rotated',
      objectType: 'SystemSecret',
      objectId: TELEGRAM_WEBHOOK_SECRET_NAME,
      payload: { webhookHost: new URL(url).host },
    })
    return { rotatedAt: (options.now ?? rotatedAt).toISOString(), webhookUrl: url }
  })
  rotation = run.catch(() => undefined)
  return run
}

async function replyTo(
  update: TelegramUpdate,
  config: TelegramConfig,
  secret: string,
  now: Date,
): Promise<string | null> {
  const message = update.message
  if (!message || message.text === undefined) return null
  const chatId = String(message.chat.id)

  // Сводка — о делах человека; в группу, где её прочтут все, она не уходит.
  if (message.chat.type !== 'private') return BOT_REPLIES.notPrivate

  const command = parseCommand(message.text, config.botUsername)
  switch (command.kind) {
    case 'start': {
      if (command.token === null) return BOT_REPLIES.startWithoutToken
      const verified = consumeLinkToken(secret, command.token, now.getTime())
      const user = verified ? await repo.findActiveUser(verified.userId) : null
      // Заблокированному, сменившему роль и с чужой ссылкой — один ответ: подробности не нужны.
      if (!user || !can(user, 'ANALYTICS')) return BOT_REPLIES.invalidToken
      await repo.linkChat(user.id, chatId, message.from?.username ?? null)
      await writeAudit({
        userId: user.id,
        action: 'telegram.link',
        objectType: 'User',
        objectId: user.id,
        payload: { source: 'telegram' },
      })
      return BOT_REPLIES.linked
    }
    case 'today': {
      const user = await repo.findActiveUserByChat(chatId)
      if (!user) return BOT_REPLIES.notLinked
      if (!can(user, 'ANALYTICS')) return BOT_REPLIES.unavailable
      return (await digestFor(user, now)).text
    }
    case 'stop': {
      const userId = await repo.unlinkChat(chatId)
      if (userId) {
        await writeAudit({
          userId,
          action: 'telegram.unlink',
          objectType: 'User',
          objectId: userId,
          payload: { source: 'telegram' },
        })
      }
      return userId ? BOT_REPLIES.stopped : BOT_REPLIES.notLinked
    }
    case 'help':
      return BOT_REPLIES.help
  }
}

/**
 * Обработка обновления после ответа вебхука. Исключений наружу не бросает:
 * Telegram уже получил 200, и повторять ему нечего. Повторы отсеяны раньше —
 * `acceptUpdate` в маршруте, до ответа.
 */
export async function handleUpdate(
  update: TelegramUpdate,
  options: { secret: string; client?: TelegramClient; now?: Date },
): Promise<void> {
  const config = telegramConfig()
  if (!config.enabled) return
  const client = options.client ?? new TelegramClient(config)
  const now = options.now ?? new Date()

  let reply: string | null
  try {
    reply = await replyTo(update, config, options.secret, now)
  } catch (error) {
    log.error('[telegram] обновление не обработано', { updateId: update.update_id, err: error })
    reply = BOT_REPLIES.unavailable
  }
  if (reply !== null && update.message) {
    // Результат не проверяем: сбой доставки клиент уже записал в журнал.
    await client.sendMessage(String(update.message.chat.id), reply)
  }
}
