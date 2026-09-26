import { assertCan } from '@/shared/auth/permissions'
import type { CurrentUser } from '@/shared/auth/current-user'
import { writeAudit } from '@/shared/audit/audit'
import { notifyOwner, OWNER_CHAT_ID_PATTERN } from '@/shared/ops/owner-alert'
import { integrationError } from '@/shared/http/errors'
import { TelegramClient } from '@/integrations/telegram'
import {
  clearBotToken,
  effectiveTelegramConfig,
  setBotToken,
  setMode,
  TELEGRAM_BOT_TOKEN_SECRET_NAME,
  TELEGRAM_MODE_SECRET_NAME,
  tokenSource,
} from '@/integrations/telegram/runtime-config'
import type { TelegramMode } from '@/integrations/config'
import type {
  TelegramAdminStatusDto,
  TelegramSetTokenDto,
  TelegramTestSentDto,
} from '@/shared/contracts/telegram'
import * as repo from './telegram.repo'
import * as runtime from './telegram.runtime'
import { rotateWebhookSecret } from './telegram.service'

/**
 * Админка бота Telegram (решение 142): статус, смена и удаление токена, режим
 * приёма, проверочное сообщение. Отдельный файл, а не `telegram.service.ts`:
 * этот слой знает и про `telegram.runtime.ts` (цикл polling), а `telegram.runtime.ts`
 * сам зависит от `telegram.service.ts` (общая обработка обновлений) — если бы
 * `telegram.service.ts` тоже знал про `telegram.runtime.ts`, вышел бы цикл импортов.
 *
 * Везде `assertCan(user, 'ADMIN')` — раздел только для администратора; ни токен,
 * ни секрет вебхука наружу не возвращаются и не пишутся в журнал (маскирование
 * решения 133 продолжается: `writeAudit` получает только служебные поля).
 */

const TEST_MESSAGE =
  'SkillLink: проверочное сообщение от администратора. Если оно дошло — бот настроен и может ' +
  'отправлять уведомления.'

function chatIdFromEnv(): string | null {
  const raw = process.env.TELEGRAM_OWNER_CHAT_ID?.trim() ?? ''
  return OWNER_CHAT_ID_PATTERN.test(raw) ? raw : null
}

/** GET /api/admin/telegram — полная картина состояния бота. */
export async function adminStatus(user: CurrentUser): Promise<TelegramAdminStatusDto> {
  assertCan(user, 'ADMIN')
  const config = effectiveTelegramConfig()
  const linkedEmployeeCount = await repo.countLinks()
  const base: Omit<
    TelegramAdminStatusDto,
    'webhookUrl' | 'pendingUpdateCount' | 'lastErrorMessage' | 'lastErrorAt' | 'running'
  > = {
    configured: config.enabled,
    botUsername: config.botUsername,
    mode: config.mode,
    linkedEmployeeCount,
    tokenSource: tokenSource(),
    ownerChatConfigured: chatIdFromEnv() !== null,
  }

  if (!config.enabled) {
    return { ...base, running: 'off', webhookUrl: null, pendingUpdateCount: null, lastErrorMessage: null, lastErrorAt: null }
  }

  // Живой запрос к Telegram (GET, не мутация): точнее, чем кеш последней auto-проверки,
  // который в режиме polling вообще не обновляется — auto-таймер тогда не работает.
  const info = await new TelegramClient(config).getWebhookInfo()
  const runtimeStatus = runtime.getRuntimeStatus()
  const running = runtimeStatus.running === 'polling' ? 'polling' : 'webhook'

  if (!info.ok) {
    const cached = runtimeStatus.lastWebhookInfo
    return {
      ...base,
      running,
      webhookUrl: cached?.url ?? null,
      pendingUpdateCount: cached?.pendingUpdateCount ?? null,
      lastErrorMessage: cached?.lastErrorMessage ?? null,
      lastErrorAt: cached?.lastErrorDate?.toISOString() ?? null,
    }
  }
  return {
    ...base,
    running,
    webhookUrl: info.info.url || null,
    pendingUpdateCount: info.info.pendingUpdateCount,
    lastErrorMessage: info.info.lastErrorMessage,
    lastErrorAt: info.info.lastErrorDate?.toISOString() ?? null,
  }
}

/**
 * PUT /api/admin/telegram/token: проверка через `getMe`, сохранение зашифрованным,
 * новый секрет вебхука (или перезапуск polling новым токеном).
 *
 * `secret` — AUTH_SECRET (`resolveSecret()`), передаётся маршрутом: ключ шифрования
 * токена и ключ обработки обновлений polling, тот же приём, что у `connect()`
 * в `telegram.service.ts` — модуль не тянет `@/shared/auth/auth` (а с ним NextAuth)
 * сам, поэтому его можно тестировать без мока всей аутентификации.
 */
export async function adminSetToken(
  user: CurrentUser,
  body: TelegramSetTokenDto,
  secret: string,
): Promise<TelegramAdminStatusDto> {
  assertCan(user, 'ADMIN')
  const token = body.token.trim()
  const probe = new TelegramClient({ ...effectiveTelegramConfig(), botToken: token, enabled: true })
  const me = await probe.getMe()
  if (!me.ok) {
    throw integrationError('Telegram не принял токен — проверьте, что он скопирован от @BotFather полностью', {
      telegramStatus: me.status,
    })
  }

  await setBotToken(secret, token, me.username, user.id)
  const config = effectiveTelegramConfig()

  if (config.mode !== 'polling') {
    // Тот же порядок, что у решения 133: сначала setWebhook у Telegram, хеш —
    // только при успехе. Отказ здесь не отменяет смену токена — администратор
    // увидит текущий webhookUrl/lastError в статусе и разберётся (или включит polling).
    await rotateWebhookSecret(user).catch(() => undefined)
  }
  await runtime.applyMode(secret, config.mode)

  await writeAudit({
    userId: user.id,
    action: 'telegram.token_changed',
    objectType: 'SystemSecret',
    objectId: TELEGRAM_BOT_TOKEN_SECRET_NAME,
    payload: { botUsername: me.username, mode: config.mode },
  })
  notifyOwner('telegram.token-changed', { details: { reason: 'сменён администратором' } })
  return adminStatus(user)
}

/** DELETE /api/admin/telegram/token: удалить токен из базы, снять вебхук, остановить polling. */
export async function adminClearToken(user: CurrentUser, secret: string): Promise<TelegramAdminStatusDto> {
  assertCan(user, 'ADMIN')
  const before = effectiveTelegramConfig()
  if (before.enabled) {
    // Лучшее из возможного: Telegram не обязан подтверждать снятие вебхука для
    // токена, который через секунду перестанет быть действующим для нас, — но
    // это единственный шанс попросить его об этом.
    await new TelegramClient(before).deleteWebhook().catch(() => undefined)
  }
  await clearBotToken()
  const after = effectiveTelegramConfig()

  if (!after.enabled) await runtime.stop()
  else await runtime.applyMode(secret, after.mode)

  await writeAudit({
    userId: user.id,
    action: 'telegram.token_removed',
    objectType: 'SystemSecret',
    objectId: TELEGRAM_BOT_TOKEN_SECRET_NAME,
    payload: { remainsConfiguredViaEnv: after.enabled },
  })
  notifyOwner('telegram.token-changed', { details: { reason: 'отключён администратором' } })
  return adminStatus(user)
}

/** PUT /api/admin/telegram/mode. */
export async function adminSetMode(user: CurrentUser, mode: TelegramMode, secret: string): Promise<TelegramAdminStatusDto> {
  assertCan(user, 'ADMIN')
  const config = effectiveTelegramConfig()
  if (!config.enabled) throw integrationError('Бот Telegram не настроен: сначала задайте токен')

  await setMode(mode, user.id)
  await runtime.applyMode(secret, mode)
  await writeAudit({
    userId: user.id,
    action: 'telegram.mode_switched',
    objectType: 'SystemSecret',
    objectId: TELEGRAM_MODE_SECRET_NAME,
    payload: { by: 'admin', to: mode },
  })
  return adminStatus(user)
}

/**
 * POST /api/admin/telegram/test: в чат администратора, если он сам подключил
 * бота, иначе в чат владельца (TELEGRAM_OWNER_CHAT_ID). Ни того ни другого — понятная ошибка.
 */
export async function adminSendTest(user: CurrentUser): Promise<TelegramTestSentDto> {
  assertCan(user, 'ADMIN')
  const config = effectiveTelegramConfig()
  if (!config.enabled) throw integrationError('Бот Telegram не настроен')

  const link = await repo.findLinkByUser(user.id)
  const ownerChat = chatIdFromEnv()
  const target = link ? { chatId: link.chatId, sentTo: 'admin' as const } : ownerChat ? { chatId: ownerChat, sentTo: 'owner' as const } : null
  if (!target) {
    throw integrationError(
      'Некуда отправить проверочное сообщение: подключите Telegram в личном кабинете или задайте TELEGRAM_OWNER_CHAT_ID',
    )
  }

  const result = await new TelegramClient(config).sendMessage(target.chatId, TEST_MESSAGE)
  if (!result.ok) {
    throw integrationError('Telegram не принял проверочное сообщение', { reason: result.reason, status: result.status })
  }
  return { sentTo: target.sentTo }
}
