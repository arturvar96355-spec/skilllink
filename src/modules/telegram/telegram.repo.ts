import { prisma } from '@/shared/db/prisma'
import type { Prisma } from '@/generated/prisma/client'
import { TIE_BREAKER } from '@/shared/http/pagination'
import type { CurrentUser } from '@/shared/auth/current-user'
import { DEADLINE_WARNING_DAYS } from '@/shared/config/analytics.config'
import { CONTROL_STAGE_NUMBER } from '@/shared/config/workflow.config'
import { addDays } from '@/shared/utils/date'
import { OPEN_COOPERATION_STATUSES } from '@/modules/cooperation/cooperation.rules'
import { problemStageWhere } from '@/modules/analytics/analytics.repo'
import type { DigestStageSource } from './telegram.rules'

/**
 * Открытые рекомендации по связкам пользователя — тот же запрос, что у «Дел на
 * сегодня» ИИ-помощника: одно определение «моих рекомендаций» на систему.
 */
export { findOpenRecommendationsOf } from '@/modules/ai-assist/ai-assist.repo'

const USER_FIELDS = { id: true, email: true, fullName: true, role: true, universityId: true } as const

export interface TelegramLinkRow {
  chatId: string
  username: string | null
  linkedAt: Date
}

export async function findLinkByUser(userId: string): Promise<TelegramLinkRow | null> {
  return prisma.telegramLink.findUnique({
    where: { userId },
    select: { chatId: true, username: true, linkedAt: true },
  })
}

/** Чей это чат. Заблокированный пользователь — как будто чат не привязан. */
export async function findActiveUserByChat(chatId: string): Promise<CurrentUser | null> {
  const link = await prisma.telegramLink.findUnique({
    where: { chatId },
    select: { user: { select: { ...USER_FIELDS, isActive: true } } },
  })
  if (!link || !link.user.isActive) return null
  const { isActive: _isActive, ...user } = link.user
  return user
}

export async function findActiveUser(userId: string): Promise<CurrentUser | null> {
  return prisma.user.findFirst({ where: { id: userId, isActive: true }, select: USER_FIELDS })
}

/**
 * Привязать чат к пользователю. Один пользователь — один чат, один чат — один
 * пользователь: прежняя привязка этого чата к другой учётной записи снимается,
 * иначе /today в нём не знал бы, чью сводку показывать.
 */
export async function linkChat(userId: string, chatId: string, username: string | null): Promise<void> {
  await prisma.$transaction([
    prisma.telegramLink.deleteMany({ where: { chatId, userId: { not: userId } } }),
    prisma.telegramLink.upsert({
      where: { userId },
      create: { userId, chatId, username },
      update: { chatId, username, linkedAt: new Date() },
    }),
  ])
}

/** Отвязать учётную запись. true — привязка была. `client` — транзакция блокировки. */
export async function unlinkUser(
  userId: string,
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<boolean> {
  const { count } = await client.telegramLink.deleteMany({ where: { userId } })
  return count > 0
}

/** Отвязать чат (/stop). Отдаёт, чья была привязка, — для журнала. */
export async function unlinkChat(chatId: string): Promise<string | null> {
  const link = await prisma.telegramLink.findUnique({ where: { chatId }, select: { userId: true } })
  if (!link) return null
  await prisma.telegramLink.deleteMany({ where: { chatId } })
  return link.userId
}

export interface DigestRecipient {
  id: string
  chatId: string
  user: CurrentUser
}

/** Привязки активных пользователей пачкой — рассылка не держит всех в памяти. */
export async function listActiveLinks(cursor: string | null, take: number): Promise<DigestRecipient[]> {
  const rows = await prisma.telegramLink.findMany({
    where: { user: { isActive: true } },
    orderBy: { id: 'asc' },
    take,
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    select: { id: true, chatId: true, user: { select: USER_FIELDS } },
  })
  return rows
}

/**
 * Этапы для сводки: связки пользователя (он ответственный за этап или за связку —
 * как у «Дел на сегодня» и на главной), а среди них
 * - проблемные по тому же условию, что счётчик на главной (`problemStageWhere`):
 *   срок вышел или этап заблокирован;
 * - незакрытые со сроком в ближайшие дни — окно берётся на сутки шире, чем
 *   `DEADLINE_WARNING_DAYS`, а точную границу решает `isDueSoon` в правилах.
 */
export async function findDigestStages(userId: string, now: Date, limit: number): Promise<DigestStageSource[]> {
  const rows = await prisma.workflowStage.findMany({
    where: {
      AND: [
        { OR: [{ responsibleId: userId }, { cooperation: { responsibleId: userId } }] },
        {
          OR: [
            problemStageWhere({}, now),
            {
              deadline: { gte: now, lte: addDays(now, DEADLINE_WARNING_DAYS + 1) },
              status: { notIn: ['COMPLETED', 'CANCELLED'] },
              stageNumber: { not: CONTROL_STAGE_NUMBER },
              cooperation: { status: { in: [...OPEN_COOPERATION_STATUSES] } },
            },
          ],
        },
      ],
    },
    select: {
      id: true,
      stageNumber: true,
      title: true,
      status: true,
      deadline: true,
      cooperation: {
        select: {
          id: true,
          university: { select: { name: true, shortName: true } },
          program: { select: { name: true } },
          stages: { select: { stageNumber: true, title: true, status: true } },
        },
      },
    },
    orderBy: [{ deadline: 'asc' }, TIE_BREAKER],
    take: limit,
  })

  return rows.map((row) => ({
    stageId: row.id,
    stageNumber: row.stageNumber,
    stageTitle: row.title,
    status: row.status,
    deadline: row.deadline,
    cooperationId: row.cooperation.id,
    universityName: row.cooperation.university.shortName ?? row.cooperation.university.name,
    programName: row.cooperation.program.name,
    siblings: row.cooperation.stages,
  }))
}

// ─────────────── Повторы обновлений и секрет вебхука (решение 123) ───────────────

/**
 * Отметить обновление как обработанное. true — впервые; false — повтор: запись
 * с этим update_id уже есть. Одна вставка без чтения — два одновременных повтора
 * не пройдут оба (первичный ключ).
 */
export async function markUpdateSeen(updateId: number): Promise<boolean> {
  const inserted = await prisma.$executeRaw`
    INSERT INTO telegram_updates_seen (update_id) VALUES (${BigInt(updateId)})
    ON CONFLICT (update_id) DO NOTHING`
  return inserted === 1
}

/** Удалить отметки старше `before`. Возвращает число удалённых. */
export async function purgeSeenUpdates(before: Date): Promise<number> {
  const { count } = await prisma.telegramUpdateSeen.deleteMany({ where: { seenAt: { lt: before } } })
  return count
}

/** SHA-256 действующего секрета из system_secrets, если его сменяли. */
export async function findSecretHash(name: string): Promise<string | null> {
  const row = await prisma.systemSecret.findUnique({ where: { name }, select: { valueHash: true } })
  return row?.valueHash ?? null
}

export async function saveSecretHash(name: string, valueHash: string, rotatedById: string): Promise<Date> {
  const row = await prisma.systemSecret.upsert({
    where: { name },
    create: { name, valueHash, rotatedById },
    update: { valueHash, rotatedById, rotatedAt: new Date() },
    select: { rotatedAt: true },
  })
  return row.rotatedAt
}
