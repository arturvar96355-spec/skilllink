import { prisma } from '@/shared/db/prisma'
import { notFound } from '@/shared/http/errors'
import { pageMeta } from '@/shared/http/pagination'
import { assertCan, universityScope } from '@/shared/auth/permissions'
import type { CurrentUser } from '@/shared/auth/current-user'
import type { PageMeta } from '@/shared/contracts/common'
import type {
  ContactDto,
  UniversityDto,
  UniversityListItemDto,
} from '@/shared/contracts/university'
import { toIso, toIsoRequired } from '@/shared/utils/date'
import * as repo from './universities.repo'
import { assertCanArchive, assertNotArchived } from './universities.rules'
import type {
  CreateUniversityInput,
  UniversityListQuery,
  UpdateUniversityInput,
} from './universities.schema'

function toContactDto(row: {
  id: string
  fullName: string
  position: string | null
  email: string | null
  phone: string | null
  isPrimary: boolean
}): ContactDto {
  return {
    id: row.id,
    fullName: row.fullName,
    position: row.position,
    email: row.email,
    phone: row.phone,
    isPrimary: row.isPrimary,
  }
}

function toListItem(
  row: repo.UniversityListRow,
  activeCooperations: number,
): UniversityListItemDto {
  return {
    id: row.id,
    name: row.name,
    shortName: row.shortName,
    city: row.city,
    region: row.region,
    status: row.status,
    programCount: row._count.programs,
    cooperationCount: row._count.cooperations,
    activeCooperationCount: activeCooperations,
    isMock: row.isMock,
    updatedAt: toIsoRequired(row.updatedAt),
    archivedAt: toIso(row.archivedAt),
  }
}

function toDetail(row: repo.UniversityDetailRow, activeCooperations: number): UniversityDto {
  const contacts = row.contacts.map(toContactDto)
  return {
    ...toListItem(row, activeCooperations),
    address: row.address,
    website: row.website,
    description: row.description,
    directionCount: row.directionCount,
    studentCount: row.studentCount,
    primaryContact: contacts.find((contact) => contact.isPrimary) ?? contacts[0] ?? null,
    contacts,
    createdAt: toIsoRequired(row.createdAt),
  }
}

export async function list(
  user: CurrentUser,
  query: UniversityListQuery,
): Promise<{ data: UniversityListItemDto[]; meta: PageMeta }> {
  assertCan(user, 'READ')
  const { rows, total } = await repo.findMany(query, universityScope(user))
  const activeByUniversity = await repo.countActiveCooperations(rows.map((row) => row.id))
  return {
    data: rows.map((row) => toListItem(row, activeByUniversity.get(row.id) ?? 0)),
    meta: pageMeta({ page: query.page, pageSize: query.pageSize }, total),
  }
}

export async function getById(user: CurrentUser, id: string): Promise<UniversityDto> {
  assertCan(user, 'READ')
  const row = await repo.findById(id, universityScope(user))
  // Чужой вуз для представителя — NOT_FOUND, существование записи не раскрывается.
  if (!row) throw notFound('Вуз не найден')
  const activeByUniversity = await repo.countActiveCooperations([row.id])
  return toDetail(row, activeByUniversity.get(row.id) ?? 0)
}

export async function create(
  user: CurrentUser,
  input: CreateUniversityInput,
): Promise<UniversityDto> {
  assertCan(user, 'WRITE')
  const { contacts, ...fields } = input
  const row = await repo.create({
    ...fields,
    ...(contacts?.length ? { contacts: { create: contacts } } : {}),
  })
  return toDetail(row, 0)
}

export async function update(
  user: CurrentUser,
  id: string,
  input: UpdateUniversityInput,
): Promise<UniversityDto> {
  assertCan(user, 'WRITE')
  const existing = await repo.findById(id, universityScope(user))
  if (!existing) throw notFound('Вуз не найден')
  assertNotArchived(existing.archivedAt)

  const row = await repo.update(id, input)
  const activeByUniversity = await repo.countActiveCooperations([row.id])
  return toDetail(row, activeByUniversity.get(row.id) ?? 0)
}

/** Архивирование вместо удаления: история сотрудничества должна сохраняться. */
export async function archive(user: CurrentUser, id: string): Promise<UniversityDto> {
  assertCan(user, 'WRITE')
  const existing = await repo.findById(id, universityScope(user))
  if (!existing) throw notFound('Вуз не найден')
  if (existing.archivedAt) return toDetail(existing, 0)

  const openCooperations = await prisma.cooperation.count({
    where: { universityId: id, status: { in: ['DRAFT', 'ACTIVE', 'PAUSED'] } },
  })
  assertCanArchive(openCooperations)

  const row = await repo.update(id, { archivedAt: new Date(), status: 'ARCHIVED' })
  return toDetail(row, 0)
}

export async function restore(user: CurrentUser, id: string): Promise<UniversityDto> {
  assertCan(user, 'WRITE')
  const existing = await repo.findById(id, universityScope(user))
  if (!existing) throw notFound('Вуз не найден')
  const row = await repo.update(id, { archivedAt: null, status: 'IN_PROGRESS' })
  const activeByUniversity = await repo.countActiveCooperations([row.id])
  return toDetail(row, activeByUniversity.get(row.id) ?? 0)
}
