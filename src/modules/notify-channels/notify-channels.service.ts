import { assertCan, can } from '@/shared/auth/permissions'
import type { CurrentUser } from '@/shared/auth/current-user'
import { writeAudit } from '@/shared/audit/audit'
import { forbidden, integrationError, notFound } from '@/shared/http/errors'
import { addDays } from '@/shared/utils/date'
import { log } from '@/shared/log/logger'
import {
  connect as telegramConnect,
  disconnect as telegramDisconnect,
  digestFor,
} from '@/modules/telegram/telegram.service'
import { CHANNEL_WEBHOOK } from '@/shared/config/notify-channels.config'
import * as repo from './notify-channels.repo'
import { adapterFor, allAdapters, CHANNEL_IDS, CHANNEL_TITLES } from './notify-channels.registry'
import { consumeLinkCode, createLinkCode } from './notify-channels.link-token'
import type { ChannelId, ParsedInbound } from './notify-channels.types'

/**
 * Каналы уведомлений: Telegram, MAX, VK (решение 144).
 *
 * Telegram-путь (привязка, вебхук, сводка через /today) не меняется — он по-прежнему
 * живёт в `src/modules/telegram` (решения 102, 133). Этот модуль добавляет MAX и VK
 * рядом и общий выбор канала для отправки: `sendToUser`/`sendToOwners`. Ни один из
 * каналов не настроен по умолчанию — блок в личном кабинете пишет «Не настроено
 * администратором», как у Telegram, ничего не падает и не требует токенов, чтобы
 * работать (решение владельца: боевых токенов MAX/VK не будет, канал остаётся
 * «для галочки», см. docs/SETUP.md).
 */

const REPLIES = {
  linked: 'Готово: подключено. Раз в день сюда будет приходить сводка «что горит у меня». Команды: сегодня, стоп.',
  transferred: 'Уведомления SkillLink перенесены в другой чат. Этот чат больше не используется.',
  invalidCode: 'Ссылка недействительна или устарела. Откройте новую ссылку в личном кабинете SkillLink.',
  notLinked: 'Этот чат не привязан к учётной записи SkillLink. Ссылка «Подключить» — в личном кабинете.',
  unavailable: 'Сводка недоступна вашей роли.',
  stopped: 'Уведомления остановлены. Подключить заново можно в личном кабинете SkillLink.',
  help: 'Команды: сегодня — сводка «что горит у меня», стоп — остановить уведомления.',
} as const

export interface ChannelStatus {
  id: ChannelId
  title: string
  configured: boolean
  linked: boolean
  username: string | null
  linkedAt: string | null
  primary: boolean
}

/** Блок «Каналы уведомлений» в личном кабинете: три строки, статус каждой. */
export async function getChannels(user: CurrentUser): Promise<ChannelStatus[]> {
  assertCan(user, 'READ')
  const [links, primary] = await Promise.all([repo.findLinksByUser(user.id), repo.getPrimaryChannel(user.id)])
  const byChannel = new Map(links.map((link) => [link.channel, link]))
  const effectivePrimary = primary ?? CHANNEL_IDS.find((id) => byChannel.has(id)) ?? null
  return CHANNEL_IDS.map((id) => {
    const link = byChannel.get(id)
    return {
      id,
      title: CHANNEL_TITLES[id],
      configured: adapterFor(id).configured(),
      linked: link !== undefined,
      username: link?.username ?? null,
      linkedAt: link?.linkedAt.toISOString() ?? null,
      primary: effectivePrimary === id,
    }
  })
}

export interface ChannelConnectResult {
  url: string
  expiresAt: string
}

/**
 * Ссылка «Подключить»/«Перепривязать». Telegram — через существующий
 * `telegram.service.connect` (публичная функция решения 102, свой формат токена);
 * MAX и VK — код этого модуля (`notify-channels.link-token.ts`, тот же приём HMAC).
 */
export async function connect(user: CurrentUser, channel: ChannelId, secret: string, now = Date.now()): Promise<ChannelConnectResult> {
  assertCan(user, 'ANALYTICS')
  if (channel === 'telegram') {
    return telegramConnect(user, secret, now)
  }
  const adapter = adapterFor(channel)
  if (!adapter.configured()) {
    throw integrationError(`Канал «${CHANNEL_TITLES[channel]}» не настроен администратором`)
  }
  const { code, expiresAt } = createLinkCode(secret, user.id, channel, now)
  const url = adapter.linkUrl(code)
  if (!url) throw integrationError(`Канал «${CHANNEL_TITLES[channel]}» не настроен администратором`)
  return { url, expiresAt: expiresAt.toISOString() }
}

/** Отключить канал у текущего пользователя. Повтор — не ошибка. */
export async function disconnect(user: CurrentUser, channel: ChannelId): Promise<ChannelStatus[]> {
  assertCan(user, 'READ')
  if (channel === 'telegram') {
    await telegramDisconnect(user)
  } else if (await repo.unlinkAltChannel(user.id, channel)) {
    await writeAudit({ userId: user.id, action: 'channel.unlink', objectType: 'User', objectId: user.id, payload: { channel, source: 'profile' } })
  }
  return getChannels(user)
}

/** Основной канал — какой из настроенных и привязанных получает сводку и оповещения. */
export async function setPrimary(user: CurrentUser, channel: ChannelId | null): Promise<ChannelStatus[]> {
  assertCan(user, 'READ')
  await repo.setPrimaryChannel(user.id, channel)
  return getChannels(user)
}

// ─────────────────────────────── Входящие MAX/VK ───────────────────────────────

/** Принять обновление к обработке: true — впервые, false — повтор (решение 144, как решение 133). */
let insertsSincePurge = 0

export async function acceptUpdate(channel: Exclude<ChannelId, 'telegram'>, updateId: string, now = new Date()): Promise<boolean> {
  const first = await repo.markUpdateSeen(channel, updateId)
  insertsSincePurge += 1
  if (insertsSincePurge >= CHANNEL_WEBHOOK.purgeEveryInserts) {
    insertsSincePurge = 0
    try {
      await repo.purgeSeenUpdates(addDays(now, -CHANNEL_WEBHOOK.seenRetentionDays))
    } catch (error) {
      log.warn('[notify-channels] старые отметки обновлений не удалены', { err: error })
    }
  }
  return first
}

/** Только для тестов. */
export function resetSeenUpdates(): void {
  insertsSincePurge = 0
}

/**
 * Обработать разобранное входящее обновление MAX/VK и отправить ответ. Исключений
 * наружу не бросает — вебхук уже ответил 200, повторять нечего (как у Telegram).
 */
export async function handleInbound(channel: Exclude<ChannelId, 'telegram'>, parsed: ParsedInbound, secret: string, now = new Date()): Promise<void> {
  if (parsed.ignored) return
  const adapter = adapterFor(channel)
  let reply: string | null = null

  try {
    if (parsed.code) {
      const verified = consumeLinkCode(secret, parsed.code, now.getTime())
      const user = verified && verified.channel === channel ? await repo.findActiveUser(verified.userId) : null
      if (!user || !can(user, 'ANALYTICS')) {
        reply = REPLIES.invalidCode
      } else {
        const { previousChatRef } = await repo.linkAltChannel(user.id, channel, parsed.chatRef, parsed.username ?? null)
        await writeAudit({ userId: user.id, action: 'channel.link', objectType: 'User', objectId: user.id, payload: { channel, source: channel } })
        if (previousChatRef) {
          adapter.send(previousChatRef, REPLIES.transferred).catch(() => undefined)
        }
        reply = REPLIES.linked
      }
    } else if (parsed.command === 'today') {
      const user = await repo.findActiveUserByChatRef(channel, parsed.chatRef)
      if (!user) reply = REPLIES.notLinked
      else if (!can(user, 'ANALYTICS')) reply = REPLIES.unavailable
      else reply = (await digestFor(user, now)).text
    } else if (parsed.command === 'stop') {
      const userId = await repo.findUserIdByChatRef(channel, parsed.chatRef)
      if (userId) {
        await repo.unlinkAltChannel(userId, channel)
        await writeAudit({ userId, action: 'channel.unlink', objectType: 'User', objectId: userId, payload: { channel, source: channel } })
        reply = REPLIES.stopped
      } else {
        reply = REPLIES.notLinked
      }
    } else {
      reply = REPLIES.help
    }
  } catch (error) {
    log.error('[notify-channels] обновление не обработано', { channel, err: error })
    reply = REPLIES.unavailable
  }

  if (reply !== null) {
    await adapter.send(parsed.chatRef, reply).catch(() => undefined)
  }
}

// ────────────────────────── Отправка: sendToUser / sendToOwners ──────────────────────────

export interface SendResult {
  sent: boolean
  channel: ChannelId | null
}

/**
 * Отправить одному пользователю через выбранный им основной канал; если он не
 * настроен, не привязан или доставка не удалась — по очереди пробует остальные
 * привязанные и настроенные каналы (порядок — `CHANNEL_IDS`, решение 144).
 */
export async function sendToUser(userId: string, text: string): Promise<SendResult> {
  const [links, primary] = await Promise.all([repo.findLinksByUser(userId), repo.getPrimaryChannel(userId)])
  if (links.length === 0) return { sent: false, channel: null }
  const byChannel = new Map(links.map((link) => [link.channel, link]))
  const order = primary ? [primary, ...CHANNEL_IDS.filter((id) => id !== primary)] : CHANNEL_IDS

  for (const channel of order) {
    const link = byChannel.get(channel)
    const adapter = adapterFor(channel)
    if (!link || !adapter.configured()) continue
    const result = await adapter.send(link.chatRef, text).catch(() => ({ ok: false as const, reason: 'failed' as const }))
    if (result.ok) return { sent: true, channel }
  }
  return { sent: false, channel: null }
}

/** Ключ получателя для оповещений владельцу: `<канал>:<чат>` — используется owner-alert.ts. */
export async function ownerRecipientKeys(): Promise<string[]> {
  const keys: string[] = []
  const ownerChat = process.env.TELEGRAM_OWNER_CHAT_ID?.trim() ?? ''
  if (/^-?\d{1,20}$/.test(ownerChat)) keys.push(`telegram:${ownerChat}`)
  try {
    const adminIds = await repo.listAdminRecipientIds()
    for (const userId of adminIds) {
      const [links, primary] = await Promise.all([repo.findLinksByUser(userId), repo.getPrimaryChannel(userId)])
      const byChannel = new Map(links.map((link) => [link.channel, link]))
      const chosen = (primary && byChannel.get(primary)) || CHANNEL_IDS.map((id) => byChannel.get(id)).find((link) => link !== undefined)
      if (chosen) keys.push(`${chosen.channel}:${chosen.chatRef}`)
    }
  } catch {
    // База недоступна — остаётся чат владельца из настроек, если задан.
  }
  return [...new Set(keys)]
}

/** Отправить по ключу `<канал>:<чат>` (см. `ownerRecipientKeys`). */
export async function dispatchToRecipientKey(key: string, text: string): Promise<{ ok: boolean }> {
  const sep = key.indexOf(':')
  if (sep <= 0) return { ok: false }
  const channel = key.slice(0, sep) as ChannelId
  const chatRef = key.slice(sep + 1)
  if (!CHANNEL_IDS.includes(channel)) return { ok: false }
  const result = await adapterFor(channel).send(chatRef, text)
  return { ok: result.ok }
}

/** Хотя бы один канал настроен администратором (не «для галочки»). */
export function anyChannelConfigured(): boolean {
  return allAdapters().some((adapter) => adapter.configured())
}

// ─────────────────────────────── Сводка (npm run telegram:digest) ───────────────────────────────

export interface DigestRunSummary {
  recipients: number
  sent: number
  empty: number
  skipped: number
  failed: number
}

/**
 * Рассылка сводки по всем каналам сразу (решение 144): получатель — любой активный
 * сотрудник с хотя бы одной привязкой, доставка — через `sendToUser` (основной канал,
 * при неудаче — по очереди остальные привязанные). Текст сводки общий для всех
 * каналов — `digestFor` из `telegram.service` (решение 120), содержимое не зависит
 * от того, куда уходит сообщение.
 */
export async function sendDigests(options: { dryRun: boolean; now?: Date; print?: (line: string) => void }): Promise<DigestRunSummary> {
  const now = options.now ?? new Date()
  const print = options.print ?? ((line: string) => console.log(line))
  const summary: DigestRunSummary = { recipients: 0, sent: 0, empty: 0, skipped: 0, failed: 0 }

  let cursor: string | null = null
  for (;;) {
    const batch = await repo.listDigestRecipients(cursor, 100)
    if (batch.length === 0) break
    cursor = batch.at(-1)!.user.id

    for (const { user } of batch) {
      summary.recipients += 1
      if (!can(user, 'ANALYTICS')) {
        summary.skipped += 1
        continue
      }
      let digest
      try {
        digest = await digestFor(user, now)
      } catch (error) {
        log.error('[notify-channels] сводка не собрана', { userId: user.id, err: error })
        summary.failed += 1
        continue
      }
      if (digest.isEmpty) {
        summary.empty += 1
        continue
      }
      if (options.dryRun) {
        print(`── пользователь ${user.id}\n${digest.text}\n`)
        summary.sent += 1
        continue
      }
      const result = await sendToUser(user.id, digest.text)
      if (result.sent) summary.sent += 1
      else summary.failed += 1
    }
  }
  return summary
}

// ─────────────────────────────── Администрирование ────────────────────────────────

export interface AdminChannelStatus {
  id: ChannelId
  title: string
  configured: boolean
  linkedCount: number
}

export async function adminStatus(user: CurrentUser): Promise<AdminChannelStatus[]> {
  assertCan(user, 'ADMIN')
  return Promise.all(
    CHANNEL_IDS.map(async (id) => ({
      id,
      title: CHANNEL_TITLES[id],
      configured: adapterFor(id).configured(),
      linkedCount: await repo.countLinks(id),
    })),
  )
}

/** «Проверить канал»: пробное сообщение администратору в тот же чат, которым он пользуется сам. */
export async function testChannel(user: CurrentUser, channel: ChannelId): Promise<{ ok: boolean; reason?: string }> {
  assertCan(user, 'ADMIN')
  if (!CHANNEL_IDS.includes(channel)) throw notFound('Канал не найден')
  const adapter = adapterFor(channel)
  if (!adapter.configured()) return { ok: false, reason: 'Канал не настроен администратором' }
  const chatRef = await repo.findChatRef(user.id, channel)
  if (!chatRef) throw forbidden(`Сначала подключите канал «${CHANNEL_TITLES[channel]}» себе — проверка шлёт сообщение в ваш чат`)
  const result = await adapter.send(chatRef, 'SkillLink: проверка канала уведомлений — если сообщение дошло, всё работает.')
  return result.ok ? { ok: true } : { ok: false, reason: result.reason }
}
