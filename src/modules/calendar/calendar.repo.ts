import { prisma } from '@/shared/db/prisma'
import type { Prisma } from '@/generated/prisma/client'
import { CONTROL_STAGE_NUMBER } from '@/shared/config/workflow.config'
import { OPEN_COOPERATION_STATUSES } from '@/shared/contracts/enums'
import type { UserRole } from '@/shared/contracts/enums'
import type { MeetingItem, StageDeadlineItem } from './calendar.rules'

// ── Подписка ─────────────────────────────────────────────────────────────────

export async function findStatus(userId: string): Promise<{ createdAt: Date } | null> {
  return prisma.calendarFeed.findUnique({ where: { userId }, select: { createdAt: true } })
}

/**
 * Выпуск или перевыпуск: одна строка на пользователя, новый хеш заменяет старый —
 * прежняя ссылка перестаёт работать в ту же секунду.
 */
export async function replace(
  userId: string,
  tokenHash: string,
  now: Date,
): Promise<{ createdAt: Date; replaced: boolean }> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.calendarFeed.findUnique({ where: { userId }, select: { userId: true } })
    const row = await tx.calendarFeed.upsert({
      where: { userId },
      create: { userId, tokenHash, createdAt: now },
      update: { tokenHash, createdAt: now },
      select: { createdAt: true },
    })
    return { createdAt: row.createdAt, replaced: existing !== null }
  })
}

export async function remove(userId: string): Promise<boolean> {
  const { count } = await prisma.calendarFeed.deleteMany({ where: { userId } })
  return count > 0
}

export interface FeedOwner {
  id: string
  email: string
  fullName: string
  role: UserRole
  universityId: string | null
  isActive: boolean
}

export async function findOwnerByHash(tokenHash: string): Promise<FeedOwner | null> {
  const row = await prisma.calendarFeed.findUnique({
    where: { tokenHash },
    select: {
      user: {
        select: { id: true, email: true, fullName: true, role: true, universityId: true, isActive: true },
      },
    },
  })
  return row?.user ?? null
}

// ── Содержимое ленты ─────────────────────────────────────────────────────────

interface Half {
  range: { lt: Date } | { gte: Date }
  order: 'asc' | 'desc'
}

/**
 * Этапы и встречи выбираются двумя половинами — до `pivot` (от ближних к дальним
 * в прошлое) и после, каждая не больше `take`. Так при переполнении из базы
 * приходят ближайшие к сегодняшнему дню события, а не самые старые.
 */
function halves(pivot: Date): Half[] {
  return [
    { range: { lt: pivot }, order: 'desc' },
    { range: { gte: pivot }, order: 'asc' },
  ]
}

const stageSelect = {
  id: true,
  stageNumber: true,
  title: true,
  status: true,
  deadline: true,
  cooperationId: true,
  cooperation: {
    select: {
      university: { select: { name: true, shortName: true } },
      program: { select: { name: true } },
    },
  },
} satisfies Prisma.WorkflowStageSelect

/**
 * Незакрытые этапы со сроком там, где пользователь ответственный за этап или
 * за связку. Связка — действующая (черновик, активна, на паузе). Контрольный
 * этап 14 система закрывает сама — напоминать о его сроке незачем, как и в ленте
 * уведомлений.
 */
export async function findDeadlines(userId: string, now: Date, take: number): Promise<StageDeadlineItem[]> {
  const base: Prisma.WorkflowStageWhereInput = {
    status: { notIn: ['COMPLETED', 'CANCELLED'] },
    stageNumber: { not: CONTROL_STAGE_NUMBER },
    cooperation: { status: { in: [...OPEN_COOPERATION_STATUSES] } },
    OR: [{ responsibleId: userId }, { cooperation: { responsibleId: userId } }],
  }

  const parts = await Promise.all(
    halves(now).map(({ range, order }) =>
      prisma.workflowStage.findMany({
        // Сравнение с датой само отбрасывает этапы без срока.
        where: { ...base, deadline: range },
        orderBy: [{ deadline: order }, { id: 'asc' }],
        take,
        select: stageSelect,
      }),
    ),
  )

  return parts.flat().flatMap((row): StageDeadlineItem[] =>
    row.deadline
      ? [
          {
            stageId: row.id,
            stageNumber: row.stageNumber,
            stageTitle: row.title,
            status: row.status,
            deadline: row.deadline,
            cooperationId: row.cooperationId,
            universityName: row.cooperation.university.shortName ?? row.cooperation.university.name,
            programName: row.cooperation.program.name,
          },
        ]
      : [],
  )
}

const universityNameSelect = { select: { name: true, shortName: true } } as const

/** Участники намеренно не выбираются: ФИО контактов и сотрудников в ленту не идут. */
const meetingSelect = {
  id: true,
  date: true,
  topic: true,
  format: true,
  cooperationId: true,
  universityId: true,
  programId: true,
  university: universityNameSelect,
  program: { select: { name: true, university: universityNameSelect } },
  cooperation: { select: { university: universityNameSelect, program: { select: { name: true } } } },
} satisfies Prisma.MeetingSelect

type MeetingRow = Prisma.MeetingGetPayload<{ select: typeof meetingSelect }>

function shortName(university: { name: string; shortName: string | null } | null | undefined): string | null {
  return university ? (university.shortName ?? university.name) : null
}

function toMeetingItem(row: MeetingRow): MeetingItem {
  return {
    meetingId: row.id,
    date: row.date,
    topic: row.topic,
    format: row.format,
    cooperationId: row.cooperationId,
    universityId: row.universityId,
    programId: row.programId,
    universityName:
      shortName(row.university) ?? shortName(row.cooperation?.university) ?? shortName(row.program?.university),
    programName: row.program?.name ?? row.cooperation?.program.name ?? null,
  }
}

/** Встречи, где пользователь ответственный или участник, начиная с `since`. */
export async function findMeetings(
  userId: string,
  now: Date,
  since: Date,
  take: number,
): Promise<MeetingItem[]> {
  const base: Prisma.MeetingWhereInput = {
    OR: [{ responsibleId: userId }, { participants: { some: { userId } } }],
  }

  const parts = await Promise.all(
    halves(now).map(({ range, order }) =>
      prisma.meeting.findMany({
        where: { ...base, date: 'lt' in range ? { gte: since, ...range } : range },
        orderBy: [{ date: order }, { id: 'asc' }],
        take,
        select: meetingSelect,
      }),
    ),
  )

  return parts.flat().map(toMeetingItem)
}
