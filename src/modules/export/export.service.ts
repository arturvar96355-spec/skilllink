import { prisma } from '@/shared/db/prisma'
import { assertCan, universityScope } from '@/shared/auth/permissions'
import { intersectUniversityFilter } from '@/shared/auth/scope'
import { writeAudit } from '@/shared/audit/audit'
import type { CurrentUser } from '@/shared/auth/current-user'
import { computeProgressPercent, findCurrentStage, isAutoManaged } from '@/modules/workflow/workflow.rules'
import * as skillsService from '@/modules/skills/skills.service'
import { csvDate, exportFileName, toCsv, type CsvValue } from './export.rules'
import type { ExportQuery } from './export.schema'

export interface ExportResult {
  fileName: string
  csv: string
  rows: number
}

const UNIVERSITY_STATUS_LABELS: Record<string, string> = {
  NEW: 'Новый',
  IN_PROGRESS: 'В работе',
  ACTIVE: 'Активен',
  PAUSED: 'Приостановлен',
  ARCHIVED: 'В архиве',
}

const COOPERATION_STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Черновик',
  ACTIVE: 'В работе',
  PAUSED: 'Приостановлена',
  COMPLETED: 'Завершена',
  CANCELLED: 'Отменена',
}

const PROGRAM_LEVEL_LABELS: Record<string, string> = {
  SPO: 'СПО',
  BACHELOR: 'Бакалавриат',
  SPECIALIST: 'Специалитет',
  MASTER: 'Магистратура',
  POSTGRADUATE: 'Аспирантура',
  DPO: 'ДПО',
}

const PROGRAM_HEADERS = [
  'Вуз', 'Программа', 'Код', 'Направление', 'Уровень', 'Длительность, мес.', 'Статус',
  'Заявки', 'Обучающихся', 'Групп', 'Источник показателей', 'Навыков', 'Связок', 'Демо-данные',
]

const COOPERATION_HEADERS = [
  'Вуз', 'Программа', 'IT-продукт', 'Статус', 'Ответственный', 'Текущий этап',
  'Название этапа', 'Статус этапа', 'Выполнено, %', 'Просрочено этапов', 'Начало занятий',
  'Цель', 'Демо-данные', 'Обновлено',
]

async function exportUniversities(
  scope: { universityId?: string },
  limit: number,
): Promise<{ headers: string[]; rows: CsvValue[][] }> {
  const rows = await prisma.university.findMany({
    where: { ...(scope.universityId ? { id: scope.universityId } : {}) },
    orderBy: { name: 'asc' },
    take: limit,
    select: {
      name: true,
      shortName: true,
      city: true,
      region: true,
      status: true,
      directionCount: true,
      studentCount: true,
      website: true,
      isMock: true,
      archivedAt: true,
      updatedAt: true,
      _count: { select: { programs: true, cooperations: true } },
      contacts: {
        where: { isPrimary: true },
        take: 1,
        select: { fullName: true, position: true, email: true },
      },
    },
  })

  return {
    headers: [
      'Название',
      'Краткое название',
      'Город',
      'Регион',
      'Статус',
      'Направлений',
      'Студентов',
      'Программ',
      'Связок',
      'Контактное лицо',
      'Должность',
      'Почта',
      'Сайт',
      'Демо-данные',
      'В архиве',
      'Обновлено',
    ],
    rows: rows.map((row) => [
      row.name,
      row.shortName,
      row.city,
      row.region,
      UNIVERSITY_STATUS_LABELS[row.status] ?? row.status,
      row.directionCount,
      row.studentCount,
      row._count.programs,
      row._count.cooperations,
      row.contacts[0]?.fullName ?? null,
      row.contacts[0]?.position ?? null,
      row.contacts[0]?.email ?? null,
      row.website,
      row.isMock,
      row.archivedAt !== null,
      csvDate(row.updatedAt),
    ]),
  }
}

async function exportPrograms(
  scope: { universityId?: string },
  query: ExportQuery,
): Promise<{ headers: string[]; rows: CsvValue[][] }> {
  const universityFilter = intersectUniversityFilter(scope, query.universityId)
  if (universityFilter === null) return { headers: PROGRAM_HEADERS, rows: [] }

  const rows = await prisma.educationalProgram.findMany({
    where: { ...universityFilter },
    orderBy: [{ university: { name: 'asc' } }, { name: 'asc' }],
    take: query.limit,
    select: {
      name: true,
      code: true,
      direction: true,
      level: true,
      durationMonths: true,
      status: true,
      applicationCount: true,
      studentCount: true,
      groupCount: true,
      metricsSource: true,
      isMock: true,
      university: { select: { name: true } },
      _count: { select: { skills: true, cooperations: true } },
    },
  })

  return {
    headers: PROGRAM_HEADERS,
    // Пустой показатель остаётся пустым: в таблице не должно появиться ноля,
    // которого в системе нет.
    rows: rows.map((row) => [
      row.university.name,
      row.name,
      row.code,
      row.direction,
      PROGRAM_LEVEL_LABELS[row.level] ?? row.level,
      row.durationMonths,
      row.status,
      row.applicationCount,
      row.studentCount,
      row.groupCount,
      row.metricsSource,
      row._count.skills,
      row._count.cooperations,
      row.isMock,
    ]),
  }
}

async function exportCooperations(
  scope: { universityId?: string },
  query: ExportQuery,
): Promise<{ headers: string[]; rows: CsvValue[][] }> {
  const universityFilter = intersectUniversityFilter(scope, query.universityId)
  if (universityFilter === null) return { headers: COOPERATION_HEADERS, rows: [] }

  const now = new Date()
  const rows = await prisma.cooperation.findMany({
    where: { ...universityFilter },
    orderBy: { updatedAt: 'desc' },
    take: query.limit,
    select: {
      status: true,
      goal: true,
      classesStartAt: true,
      targetDate: true,
      isMock: true,
      updatedAt: true,
      university: { select: { name: true } },
      program: { select: { name: true } },
      product: { select: { name: true } },
      responsible: { select: { fullName: true } },
      stages: {
        orderBy: { stageNumber: 'asc' },
        select: { stageNumber: true, title: true, status: true, deadline: true },
      },
    },
  })

  return {
    headers: COOPERATION_HEADERS,
    rows: rows.map((row) => {
      const countable = row.stages.filter((stage) => !isAutoManaged(stage.stageNumber))
      const current = findCurrentStage(row.stages)
      const overdue = countable.filter(
        (stage) =>
          stage.deadline !== null &&
          stage.deadline < now &&
          stage.status !== 'COMPLETED' &&
          stage.status !== 'CANCELLED',
      ).length

      return [
        row.university.name,
        row.program.name,
        row.product?.name ?? null,
        COOPERATION_STATUS_LABELS[row.status] ?? row.status,
        row.responsible.fullName,
        current?.stageNumber ?? null,
        current?.title ?? null,
        current?.status ?? null,
        computeProgressPercent(countable.map((stage) => stage.status)),
        overdue,
        csvDate(row.classesStartAt ?? row.targetDate),
        row.goal,
        row.isMock,
        csvDate(row.updatedAt),
      ]
    }),
  }
}

async function exportSkillGaps(
  user: CurrentUser,
  query: ExportQuery,
): Promise<{ headers: string[]; rows: CsvValue[][] }> {
  // Переиспользуется тот же расчёт, что отдаёт API: выгрузка не должна считать по-своему.
  const result = await skillsService.gaps(user, {
    limit: Math.min(query.limit, 200),
    ...(query.universityId ? { universityId: query.universityId } : {}),
  })

  return {
    headers: [
      'Навык',
      'Категория',
      'Период',
      'Спрос',
      'Спрос, 0..1',
      'Покрытие программами, 0..1',
      'Дефицит, 0..1',
      'Критичный',
      'Уровень в программах',
      'Основание',
      'Демо-данные',
    ],
    rows: result.data.map((row) => [
      row.name,
      row.category,
      result.period,
      row.demand,
      row.demandNormalized,
      row.coverage,
      row.gap,
      row.isCritical,
      row.level,
      row.explanation,
      row.isMock,
    ]),
  }
}

/**
 * Выгрузка реестра в CSV.
 *
 * Права те же, что у соответствующего раздела: выгрузка не должна стать обходным путём
 * к данным, которые роль не видит в интерфейсе. Для представителя вуза выборка сужается
 * тем же хелпером, что и везде.
 */
export async function exportDataset(user: CurrentUser, query: ExportQuery): Promise<ExportResult> {
  // Аналитика по навыкам закрыта для представителя вуза — значит, и её выгрузка тоже.
  assertCan(user, query.dataset === 'skill-gaps' ? 'ANALYTICS' : 'READ')

  const scope = universityScope(user)

  const data =
    query.dataset === 'universities'
      ? await exportUniversities(scope, query.limit)
      : query.dataset === 'programs'
        ? await exportPrograms(scope, query)
        : query.dataset === 'cooperations'
          ? await exportCooperations(scope, query)
          : await exportSkillGaps(user, query)

  await writeAudit({
    userId: user.id,
    action: 'export.download',
    objectType: 'Export',
    objectId: query.dataset,
    payload: { rows: data.rows.length, limit: query.limit },
  })

  return {
    fileName: exportFileName(query.dataset),
    csv: toCsv(data.headers, data.rows),
    rows: data.rows.length,
  }
}
