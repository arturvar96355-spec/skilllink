import { validationError } from '@/shared/http/errors'
import { toAppError } from '@/shared/http/handle'
import { assertCan } from '@/shared/auth/permissions'
import { writeAudit } from '@/shared/audit/audit'
import type { CurrentUser } from '@/shared/auth/current-user'
import type { ImportResultDto, ImportRowResultDto } from '@/shared/contracts/import'
import type { CsvEncoding } from './decode'
import { PROGRAM_LEVELS, type ProgramLevel } from '@/shared/contracts/enums'
import { PROGRAM_LEVEL_LABELS } from '@/shared/contracts/labels'
import {
  cell,
  changedColumns,
  detectDelimiter,
  mapHeaders,
  numericCell,
  parseCsv,
  presentColumns,
  schemaIssue,
  type CsvRow,
} from './import.rules'
import { PROGRAM_COLUMNS, UNIVERSITY_COLUMNS, type ImportQuery } from './import.schema'
import { createUniversitySchema, updateUniversitySchema } from '@/modules/universities/universities.schema'
import { createProgramSchema, updateProgramSchema } from '@/modules/programs/programs.schema'
import * as repo from './import.repo'
import { log } from '@/shared/log/logger'

/** Необязательные колонки вузов — по полям. */
const UNIVERSITY_OPTIONAL_COLUMNS = {
  shortName: 'Краткое название',
  website: 'Сайт',
  directionCount: 'Направлений',
  studentCount: 'Студентов',
} as const

/** Колонка по полю — для текста ошибки проверки. */
const UNIVERSITY_COLUMN_OF: Record<string, string> = {
  name: 'Название',
  city: 'Город',
  region: 'Регион',
  ...UNIVERSITY_OPTIONAL_COLUMNS,
}

const PROGRAM_OPTIONAL_COLUMNS = {
  code: 'Код',
  direction: 'Направление',
  durationMonths: 'Длительность, мес.',
  applicationCount: 'Заявки',
  studentCount: 'Обучающихся',
  groupCount: 'Групп',
} as const

/** Колонки показателей рейтинга: их изменение меняет источник показателей. */
const METRIC_COLUMNS: readonly string[] = [
  PROGRAM_OPTIONAL_COLUMNS.applicationCount,
  PROGRAM_OPTIONAL_COLUMNS.studentCount,
  PROGRAM_OPTIONAL_COLUMNS.groupCount,
]

const PROGRAM_COLUMN_OF: Record<string, string> = {
  name: 'Программа',
  level: 'Уровень',
  ...PROGRAM_OPTIONAL_COLUMNS,
}

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
    // Существование проверяется до записи, поэтому без этой проверки две одинаковые
    // строки прошли бы как два создания и дали двойника. Дальше ломалось бы всё
    // опознание «по названию»: повторная загрузка обновляла бы произвольного
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
    const existing = await repo.findUniversityByName(name)

    // Архивный вуз через файл не меняется — как и через карточку (assertNotArchived).
    if (existing?.archivedAt) {
      plans.push({
        result: { line, label: name, outcome: 'skip', detail: 'Вуз в архиве — восстановите его, чтобы изменить' },
      })
      continue
    }

    const optional = presentColumns(index, UNIVERSITY_OPTIONAL_COLUMNS, {
      shortName: cell(row, index, 'Краткое название'),
      website: cell(row, index, 'Сайт'),
      directionCount: 'value' in directions ? directions.value : null,
      studentCount: 'value' in students ? students.value : null,
    })
    const data = { city, region, ...optional }

    const checked = existing
      ? updateUniversitySchema.safeParse(data)
      : createUniversitySchema.safeParse({ name, ...data })
    if (!checked.success) {
      plans.push({
        result: {
          line,
          label: name,
          outcome: 'error',
          detail: schemaIssue(checked.error.issues, UNIVERSITY_COLUMN_OF),
        },
      })
      continue
    }

    if (existing) {
      const changed = changedColumns(existing, data, UNIVERSITY_COLUMN_OF)
      if (changed.length === 0) {
        plans.push({ result: { line, label: name, outcome: 'unchanged', detail: 'Без изменений' } })
        continue
      }
      plans.push({
        result: {
          line,
          label: name,
          outcome: 'update',
          detail: `Обновятся: ${changed.join(', ')}`,
        },
        apply: async () => {
          await repo.updateUniversity(existing.id, data)
        },
      })
      continue
    }

    plans.push({
      result: { line, label: name, outcome: 'create', detail: `Будет создан вуз в городе ${city}` },
      apply: async () => {
        // Импортированные записи демонстрационными не считаются: их завёл человек.
        await repo.createUniversity({ name, ...data, isMock: false })
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
  /** Программы, уже встреченные в этом файле: строка, где встретилась впервые. */
  const seen = new Map<string, number>()

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

    const university = await repo.findUniversityRefByName(universityName)
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

    // Повтор программы внутри одного файла — ошибка строки, а не вторая программа:
    // проверка существования идёт до записи, и две одинаковые строки дали бы двойника.
    const key = `${universityName.toLowerCase()}::${name.toLowerCase()}`
    if (seen.has(key)) {
      plans.push({
        result: { line, label, outcome: 'error', detail: `Эта программа уже встречалась в файле (строка ${seen.get(key)})` },
      })
      continue
    }
    seen.set(key, line)

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

    const optional = presentColumns(index, PROGRAM_OPTIONAL_COLUMNS, {
      code: cell(row, index, 'Код'),
      direction: cell(row, index, 'Направление'),
      durationMonths: pick(numbers.duration),
      applicationCount: pick(numbers.applications),
      studentCount: pick(numbers.students),
      groupCount: pick(numbers.groups),
    })

    const hasMetrics =
      (optional.applicationCount ?? null) !== null ||
      (optional.studentCount ?? null) !== null ||
      (optional.groupCount ?? null) !== null

    const fields = { level, ...optional }

    const existing = await repo.findProgramByName(university.id, name)

    if (existing?.archivedAt) {
      plans.push({
        result: { line, label, outcome: 'skip', detail: 'Программа в архиве — восстановите её, чтобы изменить' },
      })
      continue
    }

    const checked = existing
      ? updateProgramSchema.safeParse(fields)
      : createProgramSchema.safeParse({ universityId: university.id, name, ...fields })
    if (!checked.success) {
      plans.push({
        result: { line, label, outcome: 'error', detail: schemaIssue(checked.error.issues, PROGRAM_COLUMN_OF) },
      })
      continue
    }

    const changed = existing ? changedColumns(existing, fields, PROGRAM_COLUMN_OF) : []
    // Источник показателей меняется, только если файл меняет сами показатели:
    // повторная загрузка выгрузки не должна выдавать демо-набор за импортированный.
    const metricsChanged = existing
      ? changed.some((column) => METRIC_COLUMNS.includes(column))
      : hasMetrics
    const data = {
      ...fields,
      ...(metricsChanged ? { metricsSource: 'IMPORT' as const, metricsUpdatedAt: new Date() } : {}),
    }

    if (existing && changed.length === 0) {
      plans.push({ result: { line, label, outcome: 'unchanged', detail: 'Без изменений' } })
      continue
    }

    if (existing) {
      plans.push({
        result: { line, label, outcome: 'update', detail: `Обновятся: ${changed.join(', ')}` },
        apply: async () => {
          await repo.updateProgram(existing.id, data)
        },
      })
      continue
    }

    plans.push({
      result: { line, label, outcome: 'create', detail: 'Будет создана программа' },
      apply: async () => {
        await repo.createProgram({ universityId: university.id, name, ...data, isMock: false })
      },
    })
  }

  return plans
}

/** Загружать файлы могут только роли с правом записи. Проверка до чтения файла. */
export function assertCanImport(user: CurrentUser): void {
  assertCan(user, 'WRITE')
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

  const rows = parseCsv(csv, detectDelimiter(csv))
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
        // Наружу — только то, что можно показать: сообщение Prisma повторяет весь
        // вызов с данными строки, и в ответ ушли бы данные целиком.
        const known = toAppError(error)
        if (!known) log.error('[IMPORT] строка не записана', { line: plan.result.line, err: error })
        plan.result.outcome = 'error'
        plan.result.detail = `Не удалось записать: ${known ? known.message : 'внутренняя ошибка сервера'}`
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
    unchanged: count('unchanged'),
    errors: count('error'),
    rows: results,
    processedAt: new Date().toISOString(),
  }
}
