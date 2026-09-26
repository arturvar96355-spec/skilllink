import { prisma } from '@/shared/db/prisma'
import type { Prisma } from '@/generated/prisma/client'
import type { CurrentUser } from '@/shared/auth/current-user'
import type { ChannelId } from './notify-channels.types'

type Client = Prisma.TransactionClient | typeof prisma

/**
 * Доступ к данным каналов уведомлений (решение 144).
 *
 * Telegram читается напрямую через модель Prisma `TelegramLink` — так же, как
 * `src/shared/ops/owner-alert.ts` (решение 118) уже делает для оповещений владельцу:
 * модель схемы не является кодом модуля `src/modules/telegram`, поэтому обращение
 * к ней отсюда не задевает параллельную работу над этим модулем в другой ветке.
 * Ничего из `telegram.repo.ts` этот файл не импортирует.
 */

const USER_FIELDS = { id: true, email: true, fullName: true, role: true, universityId: true } as const

function altChannelWhere(channel: ChannelId) {
  return channel === 'telegram' ? ('TELEGRAM' as const) : channel === 'max' ? ('MAX' as const) : ('VK' as const)
}

export interface ChannelLinkRow {
  channel: ChannelId
  chatRef: string
  username: string | null
  linkedAt: Date
}

/** Все привязки пользователя — Telegram и альтернативные каналы вместе. */
export async function findLinksByUser(userId: string): Promise<ChannelLinkRow[]> {
  const [telegram, alt] = await Promise.all([
    prisma.telegramLink.findUnique({ where: { userId }, select: { chatId: true, username: true, linkedAt: true } }),
    prisma.notificationChannelLink.findMany({
      where: { userId },
      select: { channel: true, chatRef: true, username: true, linkedAt: true },
    }),
  ])
  const rows: ChannelLinkRow[] = alt.map((link) => ({
    channel: link.channel === 'MAX' ? 'max' : 'vk',
    chatRef: link.chatRef,
    username: link.username,
    linkedAt: link.linkedAt,
  }))
  if (telegram) rows.push({ channel: 'telegram', chatRef: telegram.chatId, username: telegram.username, linkedAt: telegram.linkedAt })
  return rows
}

export async function findChatRef(userId: string, channel: ChannelId): Promise<string | null> {
  if (channel === 'telegram') {
    const link = await prisma.telegramLink.findUnique({ where: { userId }, select: { chatId: true } })
    return link?.chatId ?? null
  }
  const link = await prisma.notificationChannelLink.findUnique({
    where: { userId_channel: { userId, channel: altChannelWhere(channel) } },
    select: { chatRef: true },
  })
  return link?.chatRef ?? null
}

export async function getPrimaryChannel(userId: string): Promise<ChannelId | null> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { notifyChannel: true } })
  if (!user?.notifyChannel) return null
  return user.notifyChannel === 'TELEGRAM' ? 'telegram' : user.notifyChannel === 'MAX' ? 'max' : 'vk'
}

/** null — «без основного канала», выбор снова автоматический (первый настроенный и привязанный). */
export async function setPrimaryChannel(userId: string, channel: ChannelId | null): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { notifyChannel: channel ? altChannelWhere(channel) : null },
  })
}

/**
 * Привязать чат MAX/VK к пользователю (перепривязка, решение 144). Тот же приём,
 * что `telegram.repo.linkChat`: чужая привязка этого чата снимается, у пользователя
 * остаётся один чат на канал. Отдаёт прежний чат этого пользователя на этом канале,
 * если он был и изменился, — сервис отправит туда «уведомления перенесены».
 */
export async function linkAltChannel(
  userId: string,
  channel: Exclude<ChannelId, 'telegram'>,
  chatRef: string,
  username: string | null,
): Promise<{ previousChatRef: string | null }> {
  const kind = altChannelWhere(channel)
  const previous = await prisma.notificationChannelLink.findUnique({
    where: { userId_channel: { userId, channel: kind } },
    select: { chatRef: true },
  })
  await prisma.$transaction([
    prisma.notificationChannelLink.deleteMany({ where: { channel: kind, chatRef, userId: { not: userId } } }),
    prisma.notificationChannelLink.upsert({
      where: { userId_channel: { userId, channel: kind } },
      create: { userId, channel: kind, chatRef, username },
      update: { chatRef, username, linkedAt: new Date() },
    }),
  ])
  const previousChatRef = previous && previous.chatRef !== chatRef ? previous.chatRef : null
  return { previousChatRef }
}

export async function unlinkAltChannel(userId: string, channel: Exclude<ChannelId, 'telegram'>): Promise<boolean> {
  const { count } = await prisma.notificationChannelLink.deleteMany({ where: { userId, channel: altChannelWhere(channel) } })
  return count > 0
}

/**
 * Все альтернативные каналы пользователя разом (блокировка учётной записи, решение 144:
 * то, что работает без сессии, закрывается при блокировке — как лента календаря и Telegram,
 * решения 105 и 102). Отдаёт список отвязанных каналов — для записи в журнал по каждому.
 */
export async function unlinkAllAltChannels(userId: string, client: Client = prisma): Promise<Array<Exclude<ChannelId, 'telegram'>>> {
  const links = await client.notificationChannelLink.findMany({ where: { userId }, select: { channel: true } })
  if (links.length === 0) return []
  await client.notificationChannelLink.deleteMany({ where: { userId } })
  return links.map((link) => (link.channel === 'MAX' ? 'max' : 'vk'))
}

/** Чей это чат (команда «стоп»). Отдаёт userId — сервис проверяет активность отдельно. */
export async function findUserIdByChatRef(channel: Exclude<ChannelId, 'telegram'>, chatRef: string): Promise<string | null> {
  const link = await prisma.notificationChannelLink.findUnique({
    where: { channel_chatRef: { channel: altChannelWhere(channel), chatRef } },
    select: { userId: true },
  })
  return link?.userId ?? null
}

export async function findActiveUserByChatRef(
  channel: Exclude<ChannelId, 'telegram'>,
  chatRef: string,
): Promise<CurrentUser | null> {
  const link = await prisma.notificationChannelLink.findUnique({
    where: { channel_chatRef: { channel: altChannelWhere(channel), chatRef } },
    select: { user: { select: { ...USER_FIELDS, isActive: true } } },
  })
  if (!link || !link.user.isActive) return null
  const { isActive: _isActive, ...user } = link.user
  return user
}

export async function findActiveUser(userId: string): Promise<CurrentUser | null> {
  return prisma.user.findFirst({ where: { id: userId, isActive: true }, select: USER_FIELDS })
}

export interface DigestRecipient {
  user: CurrentUser
}

/**
 * Активные пользователи с хотя бы одной привязкой — Telegram или альтернативной
 * (решение 144, единая рассылка сводки). Курсор по `id` пользователя.
 */
export async function listDigestRecipients(cursor: string | null, take: number): Promise<DigestRecipient[]> {
  const rows = await prisma.user.findMany({
    where: {
      isActive: true,
      OR: [{ telegramLink: { isNot: null } }, { notificationChannelLinks: { some: {} } }],
    },
    orderBy: { id: 'asc' },
    take,
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    select: USER_FIELDS,
  })
  return rows.map((user) => ({ user }))
}

/** Все активные администраторы с хотя бы одной привязкой — получатели оповещений владельцу. */
export async function listAdminRecipientIds(): Promise<string[]> {
  const rows = await prisma.user.findMany({
    where: {
      role: 'ADMIN',
      isActive: true,
      OR: [{ telegramLink: { isNot: null } }, { notificationChannelLinks: { some: {} } }],
    },
    select: { id: true },
  })
  return rows.map((row) => row.id)
}

// ─────────────── Повторы входящих обновлений (решение 144, как решение 133) ───────────────

export async function markUpdateSeen(channel: Exclude<ChannelId, 'telegram'>, updateId: string): Promise<boolean> {
  const inserted = await prisma.$executeRaw`
    INSERT INTO channel_updates_seen (channel, update_id) VALUES (${altChannelWhere(channel)}::"NotifyChannelKind", ${updateId})
    ON CONFLICT (channel, update_id) DO NOTHING`
  return inserted === 1
}

export async function purgeSeenUpdates(before: Date): Promise<number> {
  const { count } = await prisma.channelUpdatesSeen.deleteMany({ where: { seenAt: { lt: before } } })
  return count
}

// ─────────────────────────── Администрирование ────────────────────────────────

export async function countLinks(channel: ChannelId): Promise<number> {
  if (channel === 'telegram') return prisma.telegramLink.count()
  return prisma.notificationChannelLink.count({ where: { channel: altChannelWhere(channel) } })
}
