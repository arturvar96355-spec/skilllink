import { prisma } from '@/shared/db/prisma'
import { buildOrderBy, parseSort, toSkipTake } from '@/shared/http/pagination'
import type { Prisma } from '@/generated/prisma/client'
import { MEETING_SORT_FIELDS, type MeetingListQuery } from './meetings.schema'

const userRefSelect = { id: true, fullName: true, role: true } satisfies Prisma.UserSelect

const meetingSelect = {
  id: true,
  date: true,
  topic: true,
  format: true,
  result: true,
  nextAction: true,
  nextActionDueAt: true,
  cooperationId: true,
  universityId: true,
  programId: true,
  createdAt: true,
  updatedAt: true,
  responsible: { select: userRefSelect },
  university: { select: { id: true, name: true } },
  program: { select: { id: true, name: true } },
  participants: {
    select: {
      id: true,
      externalName: true,
      user: { select: { id: true, fullName: true, position: true } },
      contact: { select: { id: true, fullName: true, position: true } },
    },
  },
} satisfies Prisma.MeetingSelect

export type MeetingRow = Prisma.MeetingGetPayload<{ select: typeof meetingSelect }>

/** Представитель вуза видит встречи своего вуза — напрямую или через связку и программу. */
function scopeFilter(scope: { universityId?: string }): Prisma.MeetingWhereInput {
  if (!scope.universityId) return {}
  return {
    OR: [
      { universityId: scope.universityId },
      { cooperation: { universityId: scope.universityId } },
      { program: { universityId: scope.universityId } },
    ],
  }
}

export async function findMany(
  query: MeetingListQuery,
  scope: { universityId?: string },
): Promise<{ rows: MeetingRow[]; total: number }> {
  const where: Prisma.MeetingWhereInput = { ...scopeFilter(scope) }

  if (query.cooperationId) where.cooperationId = query.cooperationId
  if (query.universityId && !scope.universityId) where.universityId = query.universityId
  if (query.programId) where.programId = query.programId
  if (query.q) where.topic = { contains: query.q, mode: 'insensitive' }

  if (query.from || query.to) {
    where.date = {
      ...(query.from ? { gte: new Date(query.from) } : {}),
      ...(query.to ? { lte: new Date(query.to) } : {}),
    }
  }

  const { field, direction } = parseSort(query.sort, MEETING_SORT_FIELDS, {
    field: 'date',
    direction: 'desc',
  })

  const [rows, total] = await Promise.all([
    prisma.meeting.findMany({
      where,
      select: meetingSelect,
      orderBy: buildOrderBy({ field, direction }),
      ...toSkipTake({ page: query.page, pageSize: query.pageSize }),
    }),
    prisma.meeting.count({ where }),
  ])
  return { rows, total }
}

export async function findById(
  id: string,
  scope: { universityId?: string },
): Promise<MeetingRow | null> {
  return prisma.meeting.findFirst({ where: { id, ...scopeFilter(scope) }, select: meetingSelect })
}

export interface ParticipantInput {
  userId?: string | null
  contactId?: string | null
  externalName?: string | null
}

export async function create(
  data: Prisma.MeetingCreateInput,
  participants: ParticipantInput[],
): Promise<MeetingRow> {
  return prisma.$transaction(async (tx) => {
    const meeting = await tx.meeting.create({ data, select: { id: true } })

    if (participants.length > 0) {
      await tx.meetingParticipant.createMany({
        data: participants.map((participant) => ({
          meetingId: meeting.id,
          userId: participant.userId ?? null,
          contactId: participant.contactId ?? null,
          externalName: participant.externalName ?? null,
        })),
      })
    }

    const row = await tx.meeting.findUnique({ where: { id: meeting.id }, select: meetingSelect })
    if (!row) throw new Error('Встреча исчезла внутри транзакции')
    return row
  })
}

/** Список участников заменяется целиком: частичное изменение состава лишь путает. */
export async function update(
  id: string,
  data: Prisma.MeetingUpdateInput,
  participants: ParticipantInput[] | null,
): Promise<MeetingRow> {
  return prisma.$transaction(async (tx) => {
    await tx.meeting.update({ where: { id }, data })

    if (participants !== null) {
      await tx.meetingParticipant.deleteMany({ where: { meetingId: id } })
      if (participants.length > 0) {
        await tx.meetingParticipant.createMany({
          data: participants.map((participant) => ({
            meetingId: id,
            userId: participant.userId ?? null,
            contactId: participant.contactId ?? null,
            externalName: participant.externalName ?? null,
          })),
        })
      }
    }

    const row = await tx.meeting.findUnique({ where: { id }, select: meetingSelect })
    if (!row) throw new Error('Встреча исчезла внутри транзакции')
    return row
  })
}
