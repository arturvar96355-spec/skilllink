import { assertCan, can, canSeeContactDetails, universityScope } from '@/shared/auth/permissions'
import { writeAudit } from '@/shared/audit/audit'
import type { CurrentUser } from '@/shared/auth/current-user'
import {
  COOPERATION_STATUS_LABELS,
  DATA_ORIGIN_LABELS,
  PROGRAM_LEVEL_LABELS,
  PROGRAM_STATUS_LABELS,
  SKILL_LEVEL_LABELS,
  STAGE_STATUS_LABELS,
  UNIVERSITY_STATUS_LABELS,
} from '@/shared/contracts/labels'
import type { CooperationListQuery } from '@/modules/cooperation/cooperation.schema'
import type { ProgramListQuery } from '@/modules/programs/programs.schema'
import type { UniversityListQuery } from '@/modules/universities/universities.schema'
import {
  computeProgressPercent,
  findCurrentStage,
  isAutoManaged,
  isOverdue,
} from '@/modules/workflow/workflow.rules'
import * as analyticsService from '@/modules/analytics/analytics.service'
import * as cooperationRepo from '@/modules/cooperation/cooperation.repo'
import * as programsRepo from '@/modules/programs/programs.repo'
import * as skillsService from '@/modules/skills/skills.service'
import * as universitiesService from '@/modules/universities/universities.service'
import {
  CONTACT_HEADERS,
  PROGRAM_RATING_HEADERS,
  auditFilters,
  UNIVERSITY_RATING_HEADERS,
  contactCells,
  csvDate,
  csvLabel,
  exportFileName,
  programRatingCells,
  toCsv,
  universityRatingCells,
  type CsvValue,
} from './export.rules'
import type { ExportRequest } from './export.schema'
import * as repo from './export.repo'

export interface ExportResult {
  fileName: string
  csv: string
  rows: number
}

const COOPERATION_HEADERS = [
  'Вуз', 'Программа', 'IT-продукт', 'Статус', 'Ответственный', 'Текущий этап',
  'Название этапа', 'Статус этапа', 'Выполнено, %', 'Просрочено этапов', 'Начало занятий',
  'Цель', 'Демо-данные', 'Обновлено',
]

/**
 * Вузы — через тот же список, что открывает реестр: те же фильтры, порядок
 * и рейтинг. Балл в файле обязан совпадать с баллом на экране, поэтому он не
 * пересчитывается здесь, а приходит из сервиса реестра. Поля, которых в строке
 * реестра нет (контакт, сайт, численность), дочитываются по найденным вузам.
 */
async function exportUniversities(
  user: CurrentUser,
  filters: UniversityListQuery,
  limit: number,
): Promise<{ headers: string[]; rows: CsvValue[][] }> {
  const list = await universitiesService.list(user, { ...filters, page: 1, pageSize: limit })
  const ids = list.data.map((row) => row.id)
  const extras = await repo.findUniversityExtras(ids)
  const extraById = new Map(extras.map((row) => [row.id, row]))
  // Почта контакта — только ADMIN и MANAGER (аудит S-17, docs/PRIVACY.md).
  const withContactDetails = canSeeContactDetails(user)
  // Рейтинг — аналитика: роли без доступа к ней колонки не показываются вовсе.
  const withRating = can(user, 'ANALYTICS')

  return {
    headers: [
      'Название',
      'Краткое название',
      'Город',
      'Регион',
      'Статус',
      ...(withRating ? UNIVERSITY_RATING_HEADERS : []),
      'Направлений',
      'Студентов',
      'Программ',
      'Связок',
      ...CONTACT_HEADERS,
      'Сайт',
      'Демо-данные',
      'В архиве',
      'Обновлено',
    ],
    rows: list.data.map((row) => {
      const extra = extraById.get(row.id)
      const contact = extra?.contacts[0]
      return [
        row.name,
        row.shortName,
        row.city,
        row.region,
        csvLabel(UNIVERSITY_STATUS_LABELS, row.status),
        ...(withRating ? universityRatingCells(row.rating) : []),
        extra?.directionCount ?? null,
        extra?.studentCount ?? null,
        row.programCount,
        row.cooperationCount,
        ...contactCells(contact, withContactDetails),
        extra?.website ?? null,
        row.isMock,
        row.archivedAt !== null,
        csvDate(new Date(row.updatedAt)),
      ]
    }),
  }
}

async function exportPrograms(
  user: CurrentUser,
  filters: ProgramListQuery,
  limit: number,
): Promise<{ headers: string[]; rows: CsvValue[][] }> {
  // Тот же запрос, что у реестра программ: фильтры, область видимости и порядок.
  const { rows } = await programsRepo.findMany(
    { ...filters, page: 1, pageSize: limit },
    universityScope(user),
  )
  const ratings = await analyticsService.ratingsOfPrograms(
    user,
    rows.map((row) => ({
      programId: row.id,
      applicationCount: row.applicationCount,
      studentCount: row.studentCount,
      groupCount: row.groupCount,
      metricsSource: row.metricsSource,
      isActive: row.status === 'ACTIVE' && row.archivedAt === null,
    })),
  )

  return {
    headers: [
      'Вуз', 'Программа', 'Код', 'Направление', 'Уровень', 'Длительность, мес.', 'Статус',
      ...(ratings ? PROGRAM_RATING_HEADERS : []),
      'Заявки', 'Обучающихся', 'Групп', 'Источник показателей', 'Навыков', 'Связок', 'Демо-данные',
    ],
    // Пустой показатель остаётся пустым: в таблице не должно появиться ноля,
    // которого в системе нет.
    rows: rows.map((row) => [
      row.university.name,
      row.name,
      row.code,
      row.direction,
      csvLabel(PROGRAM_LEVEL_LABELS, row.level),
      row.durationMonths,
      csvLabel(PROGRAM_STATUS_LABELS, row.status),
      ...(ratings ? programRatingCells(ratings.get(row.id)) : []),
      row.applicationCount,
      row.studentCount,
      row.groupCount,
      csvLabel(DATA_ORIGIN_LABELS, row.metricsSource),
      row._count.skills,
      row._count.cooperations,
      row.isMock,
    ]),
  }
}

async function exportCooperations(
  user: CurrentUser,
  filters: CooperationListQuery,
  limit: number,
): Promise<{ headers: string[]; rows: CsvValue[][] }> {
  const now = new Date()
  // Условия и порядок — из реестра связок: в файл попадает то, что отобрано на экране.
  const where = cooperationRepo.buildWhere(filters, universityScope(user), now)
  if (where === null) return { headers: COOPERATION_HEADERS, rows: [] }

  const rows = await repo.findCooperations(where, filters, limit)

  return {
    headers: COOPERATION_HEADERS,
    rows: rows.map((row) => {
      const countable = row.stages.filter((stage) => !isAutoManaged(stage.stageNumber))
      const current = findCurrentStage(row.stages)
      // То же правило, что у карточки связки: своя копия правила разошлась бы
      // с ним в том, считать ли просроченными не начатые этапы (решение 84).
      const overdue = countable.filter((stage) => isOverdue(stage.deadline, stage.status, now)).length

      return [
        row.university.name,
        row.program.name,
        row.product?.name ?? null,
        csvLabel(COOPERATION_STATUS_LABELS, row.status),
        row.responsible.fullName,
        current?.stageNumber ?? null,
        current?.title ?? null,
        csvLabel(STAGE_STATUS_LABELS, current?.status),
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
  request: Extract<ExportRequest, { dataset: 'skill-gaps' }>,
): Promise<{ headers: string[]; rows: CsvValue[][] }> {
  // Переиспользуется тот же расчёт, что отдаёт API: выгрузка не должна считать по-своему.
  const result = await skillsService.gaps(user, {
    limit: Math.min(request.limit, 200),
    ...(request.universityId ? { universityId: request.universityId } : {}),
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
      csvLabel(SKILL_LEVEL_LABELS, row.level),
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
export interface ExportClient {
  /** Адрес клиента (clientAddress) — для журнала: откуда выгрузили. */
  address: string
}

export async function exportDataset(
  user: CurrentUser,
  request: ExportRequest,
  client: ExportClient,
): Promise<ExportResult> {
  // Аналитика по навыкам закрыта для представителя вуза — значит, и её выгрузка тоже.
  assertCan(user, request.dataset === 'skill-gaps' ? 'ANALYTICS' : 'READ')

  const data =
    request.dataset === 'universities'
      ? await exportUniversities(user, request.filters, request.limit)
      : request.dataset === 'programs'
        ? await exportPrograms(user, request.filters, request.limit)
        : request.dataset === 'cooperations'
          ? await exportCooperations(user, request.filters, request.limit)
          : await exportSkillGaps(user, request)

  await writeAudit({
    userId: user.id,
    action: 'export.download',
    objectType: 'Export',
    objectId: request.dataset,
    // Что ушло в файл и откуда — без самих данных: набор, число строк, фильтры
    // (строка поиска — только признаком) и адрес клиента. Адрес стирается
    // по сроку хранения (npm run db:retention, docs/PRIVACY.md).
    payload: {
      dataset: request.dataset,
      rows: data.rows.length,
      limit: request.limit,
      filters:
        'filters' in request
          ? auditFilters(request.filters)
          : request.universityId
            ? { universityId: request.universityId }
            : {},
      address: client.address,
    },
  })

  return {
    fileName: exportFileName(request.dataset),
    csv: toCsv(data.headers, data.rows),
    rows: data.rows.length,
  }
}
