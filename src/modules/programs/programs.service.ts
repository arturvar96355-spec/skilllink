import { notFound, validationError } from '@/shared/http/errors'
import { pageMeta } from '@/shared/http/pagination'
import { writeAudit } from '@/shared/audit/audit'
import { assertCan, universityScope } from '@/shared/auth/permissions'
import type { CurrentUser } from '@/shared/auth/current-user'
import type { PageMeta } from '@/shared/contracts/common'
import type {
  ProgramDto,
  ProgramListItemDto,
  ProgramMetricsDto,
  ProgramSkillDto,
} from '@/shared/contracts/program'
import { toIso, toIsoRequired } from '@/shared/utils/date'
import * as analyticsService from '@/modules/analytics/analytics.service'
import * as repo from './programs.repo'
import { toMetric } from './programs.rules'
import type {
  CreateProgramInput,
  ProgramListQuery,
  SetProgramSkillsInput,
  UpdateProgramInput,
} from './programs.schema'

function toMetrics(row: repo.ProgramListRow): ProgramMetricsDto {
  const source = row.metricsSource
  const updatedAt = row.metricsUpdatedAt
  return {
    applicationCount: toMetric(
      row.applicationCount,
      'заявки',
      'Заявки на обучение',
      source,
      updatedAt,
      row.isMock,
    ),
    studentCount: toMetric(
      row.studentCount,
      'человек',
      'Количество обучающихся',
      source,
      updatedAt,
      row.isMock,
    ),
    groupCount: toMetric(
      row.groupCount,
      'групп',
      'Количество параллельных групп',
      source,
      updatedAt,
      row.isMock,
    ),
  }
}

function toListItem(row: repo.ProgramListRow): ProgramListItemDto {
  return {
    id: row.id,
    universityId: row.universityId,
    universityName: row.university.name,
    universityShortName: row.university.shortName,
    name: row.name,
    code: row.code,
    direction: row.direction,
    level: row.level,
    durationMonths: row.durationMonths,
    status: row.status,
    metrics: toMetrics(row),
    skillCount: row._count.skills,
    cooperationCount: row._count.cooperations,
    isMock: row.isMock,
    updatedAt: toIsoRequired(row.updatedAt),
  }
}

function toSkillDto(row: repo.ProgramDetailRow['skills'][number]): ProgramSkillDto {
  return {
    skillId: row.skill.id,
    name: row.skill.name,
    category: row.skill.category,
    level: row.level,
    importance: row.importance,
    source: row.source,
    confidence: row.confidence,
    comment: row.comment,
  }
}

/**
 * Карточка программы вместе с рейтингом: дизайн показывает балл в её заголовке.
 * Считается той же шкалой, что рейтинг программ (`analytics.ratingOfProgram`).
 */
async function toDetail(user: CurrentUser, row: repo.ProgramDetailRow): Promise<ProgramDto> {
  const rating = await analyticsService.ratingOfProgram(user, {
    programId: row.id,
    applicationCount: row.applicationCount,
    studentCount: row.studentCount,
    groupCount: row.groupCount,
    metricsSource: row.metricsSource,
    isActive: row.status === 'ACTIVE' && row.archivedAt === null,
  })
  return {
    ...toListItem(row),
    skills: row.skills.map(toSkillDto),
    createdAt: toIsoRequired(row.createdAt),
    archivedAt: toIso(row.archivedAt),
    rating,
  }
}

export async function list(
  user: CurrentUser,
  query: ProgramListQuery,
): Promise<{ data: ProgramListItemDto[]; meta: PageMeta }> {
  assertCan(user, 'READ')
  const { rows, total } = await repo.findMany(query, universityScope(user))
  return {
    data: rows.map(toListItem),
    meta: pageMeta({ page: query.page, pageSize: query.pageSize }, total),
  }
}

export async function getById(user: CurrentUser, id: string): Promise<ProgramDto> {
  assertCan(user, 'READ')
  const row = await repo.findById(id, universityScope(user))
  if (!row) throw notFound('Образовательная программа не найдена')
  return toDetail(user, row)
}

export async function create(
  user: CurrentUser,
  input: CreateProgramInput,
): Promise<ProgramDto> {
  assertCan(user, 'WRITE')
  const { universityId, metricsSource, ...fields } = input

  const university = await repo.findUniversityRef(universityId)
  if (!university) throw validationError('Указан несуществующий вуз', [
    { field: 'universityId', message: 'Вуз не найден' },
  ])
  if (university.archivedAt) {
    throw validationError('Нельзя добавить программу в архивный вуз', [
      { field: 'universityId', message: 'Вуз находится в архиве' },
    ])
  }

  const hasMetrics =
    fields.applicationCount != null || fields.studentCount != null || fields.groupCount != null

  const row = await repo.create({
    ...fields,
    university: { connect: { id: universityId } },
    metricsSource: metricsSource ?? (hasMetrics ? 'MANUAL' : null),
    metricsUpdatedAt: hasMetrics ? new Date() : null,
  })
  await writeAudit({
    userId: user.id,
    action: 'program.create',
    objectType: 'EducationalProgram',
    objectId: row.id,
    payload: { universityId, fields: Object.keys(fields) },
  })
  return toDetail(user, row)
}

export async function update(
  user: CurrentUser,
  id: string,
  input: UpdateProgramInput,
): Promise<ProgramDto> {
  assertCan(user, 'WRITE')
  const existing = await repo.findById(id, universityScope(user))
  if (!existing) throw notFound('Образовательная программа не найдена')

  const touchesMetrics =
    'applicationCount' in input || 'studentCount' in input || 'groupCount' in input

  const row = await repo.update(id, {
    ...input,
    ...(touchesMetrics
      ? {
          metricsSource: input.metricsSource ?? existing.metricsSource ?? 'MANUAL',
          metricsUpdatedAt: new Date(),
        }
      : {}),
  })
  await writeAudit({
    userId: user.id,
    action: 'program.update',
    objectType: 'EducationalProgram',
    objectId: id,
    payload: { fields: Object.keys(input) },
  })
  return toDetail(user, row)
}

/** Полная замена набора навыков программы (раздел 17 ТЗ «Привязка навыков»). */
export async function setSkills(
  user: CurrentUser,
  id: string,
  input: SetProgramSkillsInput,
): Promise<ProgramDto> {
  assertCan(user, 'WRITE')
  const existing = await repo.findById(id, universityScope(user))
  if (!existing) throw notFound('Образовательная программа не найдена')

  const ids = input.skills.map((skill) => skill.skillId)
  const duplicates = ids.filter((value, index) => ids.indexOf(value) !== index)
  if (duplicates.length > 0) {
    throw validationError('Навык указан несколько раз', [
      { field: 'skills', message: `Повторяются: ${[...new Set(duplicates)].join(', ')}` },
    ])
  }

  const found = await repo.findExistingSkillIds(ids)
  const missing = ids.filter((skillId) => !found.some((skill) => skill.id === skillId))
  if (missing.length > 0) {
    throw validationError('Указаны несуществующие навыки', [
      { field: 'skills', message: `Не найдены: ${missing.join(', ')}` },
    ])
  }

  await repo.replaceSkills(id, input.skills.map((skill) => ({ ...skill })))
  await writeAudit({
    userId: user.id,
    action: 'program.skills.replace',
    objectType: 'EducationalProgram',
    objectId: id,
    payload: { skills: ids.length },
  })
  const row = await repo.findById(id, universityScope(user))
  if (!row) throw notFound('Образовательная программа не найдена')
  return toDetail(user, row)
}

export async function archive(user: CurrentUser, id: string): Promise<ProgramDto> {
  assertCan(user, 'WRITE')
  const existing = await repo.findById(id, universityScope(user))
  if (!existing) throw notFound('Образовательная программа не найдена')
  const row = await repo.update(id, { archivedAt: new Date(), status: 'ARCHIVED' })
  await writeAudit({
    userId: user.id,
    action: 'program.archive',
    objectType: 'EducationalProgram',
    objectId: id,
  })
  return toDetail(user, row)
}

/**
 * Возврат программы из архива.
 *
 * Парная операция к архивированию, как у вузов: программу, убранную в архив
 * по ошибке, должно быть чем вернуть.
 */
export async function restore(user: CurrentUser, id: string): Promise<ProgramDto> {
  assertCan(user, 'WRITE')

  const existing = await repo.findById(id, universityScope(user))
  if (!existing) throw notFound('Образовательная программа не найдена')

  const university = await repo.findUniversityArchivedAt(existing.universityId)
  if (university?.archivedAt) {
    throw validationError('Нельзя вернуть программу: её вуз находится в архиве', [
      { field: 'universityId', message: 'Сначала восстановите вуз' },
    ])
  }

  const row = await repo.update(id, { archivedAt: null, status: 'ACTIVE' })
  await writeAudit({
    userId: user.id,
    action: 'program.restore',
    objectType: 'EducationalProgram',
    objectId: id,
  })
  return toDetail(user, row)
}
