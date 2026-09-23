import { notFound } from '@/shared/http/errors'
import { pageMeta } from '@/shared/http/pagination'
import { assertCan, universityScope } from '@/shared/auth/permissions'
import { writeAudit } from '@/shared/audit/audit'
import {
  assertParticipantsBelong,
  assertStaffResponsible,
  resolveEntityLinks,
} from '@/shared/links/entity-links'
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
  const universityId = await resolveEntityLinks(user, input)

  const participants = input.participants ?? []
  await assertParticipantsBelong(universityId, participants)
  await assertStaffResponsible(input.responsibleId)

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

  if (input.participants) {
    // Вуз встречи — по её привязкам: участники обязаны быть из него.
    const universityId = await resolveEntityLinks(user, {
      cooperationId: existing.cooperationId,
      universityId: existing.universityId,
      programId: existing.programId,
    })
    await assertParticipantsBelong(universityId, input.participants)
  }
  if (input.responsibleId) await assertStaffResponsible(input.responsibleId)

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
