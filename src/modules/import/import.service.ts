import { prisma } from '@/shared/db/prisma'
import { validationError } from '@/shared/http/errors'
import { assertCan } from '@/shared/auth/permissions'
import { writeAudit } from '@/shared/audit/audit'
import type { CurrentUser } from '@/shared/auth/current-user'
import type { ImportResultDto, ImportRowResultDto } from '@/shared/contracts/import'
import type { CsvEncoding } from './decode'
import { PROGRAM_LEVELS, type ProgramLevel } from '@/shared/contracts/enums'
import { PROGRAM_LEVEL_LABELS } from '@/shared/contracts/labels'
import { cell, mapHeaders, numericCell, parseCsv, type CsvRow } from './import.rules'
import {
  PROGRAM_COLUMNS,
  UNIVERSITY_COLUMNS,
  type ImportQuery,
} from './import.schema'

/** Больше этого в один заход не принимаем: защита от случайной загрузки гигантского файла. */
const MAX_ROWS = 2000

/** Уровень образования принимается и кодом, и русской подписью — как в выгрузке. */
function parseLevel(raw: string | null): ProgramLevel | null {
  if (!raw) return null

  const asCode = raw.toUpperCase() as ProgramLevel
  if ((PROGRAM_LEVELS as readonly string[]).includes(asCode)) return asCode

  const byLabel = Object.entries(PROGRAM_LEVEL_LABELS).find(
    ([, label]) => label.toLowerCase() === raw.toLowerCase(),
  )
  return byLabel ? (byLabel[0] as ProgramLevel) : null
}

interface RowPlan {
  result: ImportRowResultDto
  apply?: () => Promise<void>
}

async function planUniversities(rows: CsvRow[]): Promise<RowPlan[]> {
  /** Названия, уже встреченные в этом файле: строка, где встретилось впервые. */
  const seenNames = new Map<string, number>()

  const header = rows[0]
  if (!header) throw validationError('Файл пуст')

  const index = mapHeaders(header, UNIVERSITY_COLUMNS.required, UNIVERSITY_COLUMNS.optional)
  const plans: RowPlan[] = []

  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i] as CsvRow
    const line = i + 1
    const name = cell(row, index, 'Название')

    if (!name) {
      plans.push({
        result: { line, label: '—', outcome: 'error', detail: 'Не заполнено название' },
      })
      continue
    }

    const city = cell(row, index, 'Город')
    const region = cell(row, index, 'Регион')
    if (!city || !region) {
      plans.push({
        result: { line, label: name, outcome: 'error', detail: 'Не заполнены город или регион' },
      })
      continue
    }

    const directions = numericCell(row, index, 'Направлений')
    const students = numericCell(row, index, 'Студентов')
    const numericError = 'error' in directions ? directions.error : 'error' in students ? students.error : null
    if (numericError) {
      plans.push({ result: { line, label: name, outcome: 'error', detail: numericError } })
      continue
    }

    // Повтор названия внутри одного файла — ошибка строки, а не второй вуз.
    //
    // Существование проверяется до записи, поэтому две одинаковые строки
    // проходили как два создания и давали двойника. Дальше ломалось всё
    // опознание «по названию»: повторная загрузка обновляла произвольного
    // из двойников, а программы привязывались то к одному, то к другому.
    if (seenNames.has(name.toLowerCase())) {
      plans.push({
        result: {
          line,
          label: name,
          outcome: 'error',
          detail: `Это название уже встречалось в файле (строка ${seenNames.get(name.toLowerCase())})`,
        },
      })
      continue
    }
    seenNames.set(name.toLowerCase(), line)

    // Вуз опознаётся по названию: другого устойчивого ключа в файле у человека нет.
    const existing = await prisma.university.findFirst({
      where: { name },
      select: { id: true, city: true, region: true },
    })

    // Обновляются ТОЛЬКО те поля, чьи колонки есть в файле.
    //
    // Иначе загрузка файла с одними обязательными колонками стирала бы всё
    // остальное: краткое название, сайт, численность — молча, и в предпросмотре
    // это выглядело бы как безобидное «обновятся данные вуза».
    //
    // Пустая ячейка при наличии колонки — по-прежнему осознанное «нет данных»
    // и очищает поле. Разница именно между «колонки нет» и «колонка пустая».
    // Обновление частичное, создание требует обязательных полей — отсюда два типа.
    const optional: {
      shortName?: string | null
      website?: string | null
      directionCount?: number | null
      studentCount?: number | null
    } = {}
    if (index.has('Краткое название')) optional.shortName = cell(row, index, 'Краткое название')
    if (index.has('Сайт')) optional.website = cell(row, index, 'Сайт')
    if (index.has('Направлений')) {
      optional.directionCount = 'value' in directions ? directions.value : null
    }
    if (index.has('Студентов')) {
      optional.studentCount = 'value' in students ? students.value : null
    }

    const data = { city, region, ...optional }

    if (existing) {
      plans.push({
        result: {
          line,
          label: name,
          outcome: 'update',
          detail: `Обновятся данные вуза (город: ${existing.city} → ${city})`,
        },
        apply: async () => {
          await prisma.university.update({ where: { id: existing.id }, data })
        },
      })
      continue
    }

    plans.push({
      result: { line, label: name, outcome: 'create', detail: `Будет создан вуз в городе ${city}` },
      apply: async () => {
        // Импортированные записи демонстрационными не считаются: их завёл человек.
        await prisma.university.create({ data: { name, ...data, isMock: false } })
      },
    })
  }

  return plans
}

async function planPrograms(rows: CsvRow[]): Promise<RowPlan[]> {
  const header = rows[0]
  if (!header) throw validationError('Файл пуст')

  const index = mapHeaders(header, PROGRAM_COLUMNS.required, PROGRAM_COLUMNS.optional)
  const plans: RowPlan[] = []

  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i] as CsvRow
    const line = i + 1
    const universityName = cell(row, index, 'Вуз')
    const name = cell(row, index, 'Программа')
    const label = `${universityName ?? '—'} — ${name ?? '—'}`

    if (!universityName || !name) {
      plans.push({
        result: { line, label, outcome: 'error', detail: 'Не заполнены вуз или название программы' },
      })
      continue
    }

    const level = parseLevel(cell(row, index, 'Уровень'))
    if (!level) {
      plans.push({
        result: {
          line,
          label,
          outcome: 'error',
          detail: `Неизвестный уровень образования. Допустимы: ${Object.values(PROGRAM_LEVEL_LABELS).join(', ')}`,
        },
      })
      continue
    }

    const university = await prisma.university.findFirst({
      where: { name: universityName },
      select: { id: true, archivedAt: true },
    })
    if (!university) {
      plans.push({
        result: {
          line,
          label,
          outcome: 'error',
          // Вуз не создаётся по ходу: опечатка в названии породила бы двойника.
          detail: 'Вуз не найден. Сначала загрузите вузы или исправьте название',
        },
      })
      continue
    }
    if (university.archivedAt) {
      plans.push({ result: { line, label, outcome: 'skip', detail: 'Вуз находится в архиве' } })
      continue
    }

    const numbers = {
      duration: numericCell(row, index, 'Длительность, мес.'),
      applications: numericCell(row, index, 'Заявки'),
      students: numericCell(row, index, 'Обучающихся'),
      groups: numericCell(row, index, 'Групп'),
    }
    const numericError = Object.values(numbers).find((item) => 'error' in item)
    if (numericError && 'error' in numericError) {
      plans.push({ result: { line, label, outcome: 'error', detail: numericError.error } })
      continue
    }

    const pick = (item: { value: number | null } | { error: string }): number | null =>
      'value' in item ? item.value : null

    const hasMetrics =
      pick(numbers.applications) !== null ||
      pick(numbers.students) !== null ||
      pick(numbers.groups) !== null

    const data = {
      level,
      code: cell(row, index, 'Код'),
      direction: cell(row, index, 'Направление'),
      durationMonths: pick(numbers.duration),
      applicationCount: pick(numbers.applications),
      studentCount: pick(numbers.students),
      groupCount: pick(numbers.groups),
      ...(hasMetrics
        ? { metricsSource: 'IMPORT' as const, metricsUpdatedAt: new Date() }
        : {}),
    }

    const existing = await prisma.educationalProgram.findFirst({
      where: { universityId: university.id, name },
      select: { id: true },
    })

    if (existing) {
      plans.push({
        result: { line, label, outcome: 'update', detail: 'Обновятся данные программы' },
        apply: async () => {
          await prisma.educationalProgram.update({ where: { id: existing.id }, data })
        },
      })
      continue
    }

    plans.push({
      result: { line, label, outcome: 'create', detail: 'Будет создана программа' },
      apply: async () => {
        await prisma.educationalProgram.create({
          data: { universityId: university.id, name, ...data, isMock: false },
        })
      },
    })
  }

  return plans
}

/**
 * Загрузка реестра из CSV.
 *
 * Работает в два шага: сначала предпросмотр с построчным разбором, потом применение.
 * Строка с ошибкой не отменяет остальные — человек чинит её и загружает файл снова;
 * повторная загрузка не создаёт двойников, потому что записи опознаются по названию.
 */
export async function importDataset(
  user: CurrentUser,
  query: ImportQuery,
  csv: string,
  encoding: CsvEncoding = 'utf-8',
): Promise<ImportResultDto> {
  assertCan(user, 'WRITE')

  if (csv.trim() === '') {
    throw validationError('Файл пуст', [{ field: 'csv', message: 'Передайте содержимое файла' }])
  }

  const rows = parseCsv(csv)
  if (rows.length < 2) {
    throw validationError('В файле нет строк с данными', [
      { field: 'csv', message: 'Ожидались заголовок и хотя бы одна строка' },
    ])
  }
  if (rows.length - 1 > MAX_ROWS) {
    throw validationError(`За один раз принимается не больше ${MAX_ROWS} строк`, [
      { field: 'csv', message: `В файле ${rows.length - 1} строк` },
    ])
  }

  const plans =
    query.dataset === 'universities' ? await planUniversities(rows) : await planPrograms(rows)

  if (query.mode === 'apply') {
    for (const plan of plans) {
      if (!plan.apply) continue
      try {
        await plan.apply()
      } catch (error) {
        plan.result.outcome = 'error'
        plan.result.detail = `Не удалось записать: ${
          error instanceof Error ? error.message : 'неизвестная ошибка'
        }`
      }
    }
  }

  const results = plans.map((plan) => plan.result)
  const count = (outcome: ImportRowResultDto['outcome']): number =>
    results.filter((row) => row.outcome === outcome).length

  if (query.mode === 'apply') {
    await writeAudit({
      userId: user.id,
      action: 'import.apply',
      objectType: 'Import',
      objectId: query.dataset,
      payload: { rows: results.length, created: count('create'), updated: count('update') },
    })
  }

  return {
    dataset: query.dataset,
    encoding,
    mode: query.mode,
    totalRows: results.length,
    created: count('create'),
    updated: count('update'),
    skipped: count('skip'),
    errors: count('error'),
    rows: results,
    processedAt: new Date().toISOString(),
  }
}
