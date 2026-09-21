import { prisma } from '@/shared/db/prisma'
import { notFound, validationError } from '@/shared/http/errors'
import { pageMeta } from '@/shared/http/pagination'
import { assertCan, isUniversityVisible, universityScope } from '@/shared/auth/permissions'
import { writeAudit } from '@/shared/audit/audit'
import type { CurrentUser } from '@/shared/auth/current-user'
import type { PageMeta } from '@/shared/contracts/common'
import type {
  MeetingDto,
  MeetingLinksDto,
  MeetingParticipantDto,
} from '@/shared/contracts/meeting'
import { toIso, toIsoRequired } from '@/shared/utils/date'
import * as repo from './meetings.repo'
import { assertHasLink, assertNextActionHasDate } from './meetings.rules'
import type {
  CreateMeetingInput,
  MeetingListQuery,
  UpdateMeetingInput,
} from './meetings.schema'

function toParticipant(row: repo.MeetingRow['participants'][number]): MeetingParticipantDto {
  if (row.user) {
    return { id: row.id, kind: 'user', name: row.user.fullName, position: row.user.position }
  }
  if (row.contact) {
    return { id: row.id, kind: 'contact', name: row.contact.fullName, position: row.contact.position }
  }
  return { id: row.id, kind: 'external', name: row.externalName ?? 'Участник', position: null }
}

function toLinks(row: repo.MeetingRow): MeetingLinksDto {
  return {
    cooperationId: row.cooperationId,
    universityId: row.universityId,
    universityName: row.university?.name ?? null,
    programId: row.programId,
    programName: row.program?.name ?? null,
  }
}

function toDto(row: repo.MeetingRow): MeetingDto {
  return {
    id: row.id,
    date: toIsoRequired(row.date),
    topic: row.topic,
    format: row.format,
    result: row.result,
    nextAction: row.nextAction,
    nextActionDueAt: toIso(row.nextActionDueAt),
    responsible: row.responsible,
    participants: row.participants.map(toParticipant),
    links: toLinks(row),
    createdAt: toIsoRequired(row.createdAt),
    updatedAt: toIsoRequired(row.updatedAt),
  }
}

/** Привязки должны существовать и быть видны пользователю. */
async function assertLinksVisible(
  user: CurrentUser,
  links: { cooperationId?: string | null; universityId?: string | null; programId?: string | null },
): Promise<void> {
  if (links.cooperationId) {
    const cooperation = await prisma.cooperation.findUnique({
      where: { id: links.cooperationId },
      select: { universityId: true },
    })
    if (!cooperation || !isUniversityVisible(user, cooperation.universityId)) {
      throw validationError('Указана несуществующая связка', [
        { field: 'cooperationId', message: 'Связка не найдена' },
      ])
    }
  }

  if (links.universityId) {
    const university = await prisma.university.findUnique({
      where: { id: links.universityId },
      select: { id: true },
    })
    if (!university || !isUniversityVisible(user, links.universityId)) {
      throw validationError('Указан несуществующий вуз', [
        { field: 'universityId', message: 'Вуз не найден' },
      ])
    }
  }

  if (links.programId) {
    const program = await prisma.educationalProgram.findUnique({
      where: { id: links.programId },
      select: { universityId: true },
    })
    if (!program || !isUniversityVisible(user, program.universityId)) {
      throw validationError('Указана несуществующая программа', [
        { field: 'programId', message: 'Программа не найдена' },
      ])
    }
  }
}

/** Участники должны существовать: битая ссылка в составе встречи хуже её отсутствия. */
async function assertParticipantsExist(participants: repo.ParticipantInput[]): Promise<void> {
  const userIds = participants
    .map((participant) => participant.userId)
    .filter((id): id is string => typeof id === 'string')
  const contactIds = participants
    .map((participant) => participant.contactId)
    .filter((id): id is string => typeof id === 'string')

  if (userIds.length > 0) {
    const found = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true },
    })
    const missing = userIds.filter((id) => !found.some((user) => user.id === id))
    if (missing.length > 0) {
      throw validationError('Указаны несуществующие сотрудники', [
        { field: 'participants', message: `Не найдены: ${missing.join(', ')}` },
      ])
    }
  }

  if (contactIds.length > 0) {
    const found = await prisma.contact.findMany({
      where: { id: { in: contactIds } },
      select: { id: true },
    })
    const missing = contactIds.filter((id) => !found.some((contact) => contact.id === id))
    if (missing.length > 0) {
      throw validationError('Указаны несуществующие контактные лица', [
        { field: 'participants', message: `Не найдены: ${missing.join(', ')}` },
      ])
    }
  }
}

export async function list(
  user: CurrentUser,
  query: MeetingListQuery,
): Promise<{ data: MeetingDto[]; meta: PageMeta }> {
  assertCan(user, 'READ')
  const { rows, total } = await repo.findMany(query, universityScope(user))
  return {
    data: rows.map(toDto),
    meta: pageMeta({ page: query.page, pageSize: query.pageSize }, total),
  }
}

export async function getById(user: CurrentUser, id: string): Promise<MeetingDto> {
  assertCan(user, 'READ')
  const row = await repo.findById(id, universityScope(user))
  if (!row) throw notFound('Встреча не найдена')
  return toDto(row)
}

export async function create(user: CurrentUser, input: CreateMeetingInput): Promise<MeetingDto> {
  assertCan(user, 'WRITE')
  assertHasLink(input)
  assertNextActionHasDate(input.nextAction, input.nextActionDueAt)
  await assertLinksVisible(user, input)

  const participants = input.participants ?? []
  await assertParticipantsExist(participants)

  const responsible = await prisma.user.findFirst({
    where: { id: input.responsibleId, isActive: true },
    select: { id: true },
  })
  if (!responsible) {
    throw validationError('Указан несуществующий ответственный', [
      { field: 'responsibleId', message: 'Сотрудник не найден' },
    ])
  }

  const row = await repo.create(
    {
      date: new Date(input.date),
      topic: input.topic,
      format: input.format,
      result: input.result ?? null,
      nextAction: input.nextAction ?? null,
      nextActionDueAt: input.nextActionDueAt ? new Date(input.nextActionDueAt) : null,
      responsible: { connect: { id: input.responsibleId } },
      ...(input.cooperationId ? { cooperation: { connect: { id: input.cooperationId } } } : {}),
      ...(input.universityId ? { university: { connect: { id: input.universityId } } } : {}),
      ...(input.programId ? { program: { connect: { id: input.programId } } } : {}),
    },
    participants,
  )

  await writeAudit({
    userId: user.id,
    action: 'meeting.create',
    objectType: 'Meeting',
    objectId: row.id,
    payload: { cooperationId: input.cooperationId ?? null, participants: participants.length },
  })

  return toDto(row)
}

export async function update(
  user: CurrentUser,
  id: string,
  input: UpdateMeetingInput,
): Promise<MeetingDto> {
  assertCan(user, 'WRITE')

  const existing = await repo.findById(id, universityScope(user))
  if (!existing) throw notFound('Встреча не найдена')

  // Срок проверяем по итоговому состоянию: действие могло быть задано раньше.
  assertNextActionHasDate(
    input.nextAction !== undefined ? input.nextAction : existing.nextAction,
    input.nextActionDueAt !== undefined
      ? input.nextActionDueAt
      : existing.nextActionDueAt?.toISOString(),
  )

  if (input.participants) await assertParticipantsExist(input.participants)

  if (input.responsibleId) {
    const responsible = await prisma.user.findFirst({
      where: { id: input.responsibleId, isActive: true },
      select: { id: true },
    })
    if (!responsible) {
      throw validationError('Указан несуществующий ответственный', [
        { field: 'responsibleId', message: 'Сотрудник не найден' },
      ])
    }
  }

  const row = await repo.update(
    id,
    {
      ...(input.date !== undefined ? { date: new Date(input.date) } : {}),
      ...(input.topic !== undefined ? { topic: input.topic } : {}),
      ...(input.format !== undefined ? { format: input.format } : {}),
      ...(input.result !== undefined ? { result: input.result } : {}),
      ...(input.nextAction !== undefined ? { nextAction: input.nextAction } : {}),
      ...(input.nextActionDueAt !== undefined
        ? { nextActionDueAt: input.nextActionDueAt ? new Date(input.nextActionDueAt) : null }
        : {}),
      ...(input.responsibleId ? { responsible: { connect: { id: input.responsibleId } } } : {}),
    },
    input.participants ?? null,
  )

  await writeAudit({
    userId: user.id,
    action: 'meeting.update',
    objectType: 'Meeting',
    objectId: id,
    payload: { fields: Object.keys(input) },
  })

  return toDto(row)
}
