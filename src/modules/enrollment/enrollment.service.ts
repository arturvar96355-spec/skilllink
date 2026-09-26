import { randomUUID } from 'node:crypto'
import { AppError, conflict, notFound, validationError } from '@/shared/http/errors'
import { assertCan } from '@/shared/auth/permissions'
import { writeAudit } from '@/shared/audit/audit'
import { findNul } from '@/shared/db/storable'
import { pageMeta } from '@/shared/http/pagination'
import { toIso } from '@/shared/utils/date'
import { catalogNameKey } from '@/shared/utils/contacts'
import { MAX_SITE_ORDERS_PER_UPLOAD, lmsUsersFileName, resolveOrdersHmacKey } from '@/shared/config/enrollment.config'
import { buildLmsUsersFile, type LmsUserRow } from '@/integrations/lms/lms-users-file'
import type { CurrentUser } from '@/shared/auth/current-user'
import type { PageMeta } from '@/shared/contracts/common'
import type {
  ImportIssueDto,
  SchoolCourseDto,
  SchoolCoursesTotalsDto,
  SiteOrdersCourseSummaryDto,
  SiteOrdersImportResultDto,
  SiteOrdersQualityDto,
} from '@/shared/contracts/enrollment'
import { ListenerIndex, ORDER_FIELDS, analyzeOrders, countListeners, type ParsedOrder } from './enrollment.rules'
import type {
  CreateSchoolCourseInput,
  LmsFileQuery,
  SchoolCourseListQuery,
  SiteOrdersQuery,
} from './enrollment.schema'
import * as repo from './enrollment.repo'

/**
 * Набор на курсы ИТ-Школы (решение 132): заказы с сайта → показатели набора и файл для LMS.
 *
 * Главное правило модуля: ФИО, почта и телефон слушателя не пишутся ни в базу,
 * ни в журнал, ни в ответ JSON. В базе — номер заявки, курс, поток, дата и HMAC
 * от почты и телефона. ПД живут в памяти запроса и уходят только в файл для LMS.
 */

// ─────────────────────────── Разбор тела ───────────────────────────

/** Тело загрузки — JSON-массив заказов, как выгружает сайт. */
export function parseOrdersBody(bytes: Uint8Array): unknown[] {
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw validationError('Файл заказов должен быть в кодировке UTF-8', [
      { field: 'file', message: 'Сохраните выгрузку сайта как JSON в UTF-8' },
    ])
  }
  let raw: unknown
  try {
    raw = JSON.parse(text.replace(/^\uFEFF/, ''))
  } catch {
    throw validationError('Файл заказов — не корректный JSON', [
      { field: 'file', message: 'Ожидался JSON-массив заказов, как в выгрузке сайта' },
    ])
  }
  if (!Array.isArray(raw)) {
    throw validationError('Файл заказов должен быть JSON-массивом', [
      { field: 'file', message: 'Ожидался массив [ {…}, {…} ]' },
    ])
  }
  if (raw.length === 0) throw validationError('В файле нет заказов', [{ field: 'file', message: 'Массив пуст' }])
  if (raw.length > MAX_SITE_ORDERS_PER_UPLOAD) {
    throw validationError(`За один раз принимается не больше ${MAX_SITE_ORDERS_PER_UPLOAD} заказов`, [
      { field: 'file', message: `В файле ${raw.length} элементов` },
    ])
  }
  const nul = findNul(raw)
  if (nul !== null) {
    throw validationError('Файл заказов содержит недопустимый символ', [
      { field: nul, message: 'Символ с кодом 0 — уберите его' },
    ])
  }
  return raw
}

function hmacKey(): string {
  try {
    return resolveOrdersHmacKey()
  } catch (error) {
    // Настройка сервера, а не ошибка пользователя: текст понятен администратору.
    throw new AppError('INTERNAL', error instanceof Error ? error.message.split('\n')[0]! : 'Не задан ORDERS_HMAC_KEY')
  }
}

// ─────────────────────────── План загрузки ───────────────────────────

interface OrdersPlan {
  orders: ParsedOrder[]
  errors: ImportIssueDto[]
  warnings: ImportIssueDto[]
  quality: SiteOrdersQualityDto
  /** Курс заказа по ключу названия. */
  courseOf: Map<string, { id: string; name: string; streams: Array<{ id: string; number: number }> }>
  /** Уже загруженные заказы — по номеру. */
  existing: Map<string, Awaited<ReturnType<typeof repo.findOrdersByNumbers>>[number]>
  /** Новые заказы с известным курсом. */
  toCreate: ParsedOrder[]
}

async function planOrders(items: readonly unknown[]): Promise<OrdersPlan> {
  const analysis = analyzeOrders(items, hmacKey())
  const errors = [...analysis.errors]
  const warnings = [...analysis.warnings]

  const courses = await repo.findCoursesByKeys([...new Set(analysis.orders.map((order) => order.courseKey))])
  const courseOf = new Map(courses.map((course) => [course.nameKey, course]))

  const unknown = new Map<string, { name: string; rows: number }>()
  const known: ParsedOrder[] = []
  for (const order of analysis.orders) {
    if (courseOf.has(order.courseKey)) {
      known.push(order)
      continue
    }
    const entry = unknown.get(order.courseKey) ?? { name: order.courseName, rows: 0 }
    entry.rows += 1
    unknown.set(order.courseKey, entry)
    errors.push({
      row: order.row,
      column: ORDER_FIELDS.course,
      message: `Курса «${order.courseName}» нет в системе — заведите его или исправьте название`,
    })
  }

  const existingRows = await repo.findOrdersByNumbers(known.map((order) => order.orderNo))
  const existing = new Map(existingRows.map((row) => [row.orderNo, row]))
  const toCreate = known.filter((order) => !existing.has(order.orderNo))
  for (const order of known) {
    if (existing.has(order.orderNo)) {
      warnings.push({ row: order.row, column: ORDER_FIELDS.orderNo, message: `${order.orderNo}: заказ уже загружен — повторно не создаётся` })
    }
  }

  // Слушатели, которые уже были в прошлых загрузках: совпал HMAC почты или телефона
  // у заказа с другим номером. Сравниваются только хеши — сами адреса в базе не лежат.
  const newNumbers = new Set(toCreate.map((order) => order.orderNo))
  const hashes = [...new Set(toCreate.flatMap((order) => [order.emailHash, order.phoneHash]).filter((h): h is string => h !== null))]
  const previous = (await repo.findOrdersByHashes(hashes)).filter((row) => !newNumbers.has(row.orderNo))
  const previousHashes = new Set(previous.flatMap((row) => [row.emailHash, row.phoneHash]).filter((h): h is string => h !== null))
  const knownIndex = new ListenerIndex()
  for (const order of toCreate) knownIndex.add([order.emailHash, order.phoneHash])
  const knownPersons = new Set(
    toCreate
      .filter((order) => previousHashes.has(order.emailHash) || (order.phoneHash !== null && previousHashes.has(order.phoneHash)))
      .map((order) => knownIndex.personOf([order.emailHash, order.phoneHash])),
  )

  const newStreams = new Map<string, { courseName: string; number: number }>()
  for (const order of toCreate) {
    if (order.streamNumber === null) continue
    const course = courseOf.get(order.courseKey)!
    if (course.streams.some((stream) => stream.number === order.streamNumber)) continue
    newStreams.set(`${course.id}#${order.streamNumber}`, { courseName: course.name, number: order.streamNumber })
  }

  const rowsWithErrors = new Set(errors.map((issue) => issue.row)).size
  const quality: SiteOrdersQualityDto = {
    totalItems: analysis.quality.totalItems,
    emptyItemsSkipped: analysis.quality.emptyItemsSkipped,
    validRows: analysis.orders.length - [...unknown.values()].reduce((sum, item) => sum + item.rows, 0),
    rowsWithErrors,
    phonesNormalized: analysis.quality.phonesNormalized,
    emailsLowercased: analysis.quality.emailsLowercased,
    namesFixed: analysis.quality.namesFixed,
    brokenOrderNumbers: analysis.quality.brokenOrderNumbers,
    duplicateOrderNumbersInFile: analysis.quality.duplicateOrderNumbersInFile,
    duplicateListenersInFile: analysis.quality.duplicateListenersInFile,
    alreadyImported: known.length - toCreate.length,
    knownListeners: knownPersons.size,
    unknownCourses: [...unknown.values()],
    newStreams: [...newStreams.values()],
  }

  errors.sort((a, b) => a.row - b.row)
  warnings.sort((a, b) => a.row - b.row)
  return { orders: analysis.orders, errors, warnings, quality, courseOf, existing, toCreate }
}

function courseSummary(plan: OrdersPlan): SiteOrdersCourseSummaryDto[] {
  const groups = new Map<string, SiteOrdersCourseSummaryDto>()
  for (const order of plan.toCreate) {
    const course = plan.courseOf.get(order.courseKey)!
    const key = `${course.id}#${order.streamNumber ?? '-'}`
    const entry = groups.get(key) ?? { courseId: course.id, courseName: course.name, streamNumber: order.streamNumber, orders: 0 }
    entry.orders += 1
    groups.set(key, entry)
  }
  return [...groups.values()].sort(
    (a, b) => a.courseName.localeCompare(b.courseName, 'ru') || (a.streamNumber ?? 0) - (b.streamNumber ?? 0),
  )
}

/** Загружать заказы могут только те, кто ведёт набор. Проверка — до чтения тела. */
export function assertCanImportOrders(user: CurrentUser): void {
  assertCan(user, 'SITE_ORDERS')
}

/**
 * Загрузка заказов с сайта. `preview` — отчёт без записи, `apply` — запись.
 * Повторная загрузка того же файла ничего не создаёт: заказ узнаётся по номеру.
 */
export async function importSiteOrders(
  user: CurrentUser,
  query: SiteOrdersQuery,
  items: readonly unknown[],
): Promise<SiteOrdersImportResultDto> {
  assertCanImportOrders(user)
  const plan = await planOrders(items)

  let batchId: string | null = null
  let created = plan.toCreate.length
  if (query.mode === 'apply') {
    created = 0
    if (plan.toCreate.length > 0) {
      batchId = randomUUID()
      created = await repo.createOrders(
        plan.toCreate.map((order) => ({
          orderNo: order.orderNo,
          courseId: plan.courseOf.get(order.courseKey)!.id,
          streamNumber: order.streamNumber,
          emailHash: order.emailHash,
          phoneHash: order.phoneHash,
          orderedAt: order.orderedAt,
        })),
        batchId,
        user.id,
      )
    }
    // Только счётчики: ни номеров заявок, ни хешей — журнал читает администратор,
    // а номер заявки вместе с сайтом снова ведёт к человеку.
    await writeAudit({
      userId: user.id,
      action: 'import.site_orders',
      objectType: 'Import',
      objectId: batchId ?? 'site-orders',
      payload: {
        items: plan.quality.totalItems,
        created,
        alreadyImported: plan.quality.alreadyImported,
        errors: plan.quality.rowsWithErrors,
        brokenOrderNumbers: plan.quality.brokenOrderNumbers,
        newStreams: plan.quality.newStreams.length,
      },
    })
  }

  return {
    mode: query.mode,
    batchId,
    toCreate: created,
    errors: plan.errors,
    warnings: plan.warnings,
    quality: plan.quality,
    courses: courseSummary(plan),
    processedAt: new Date().toISOString(),
  }
}

// ─────────────────────────── Файл для LMS ───────────────────────────

export interface LmsFileResult {
  file: Buffer
  fileName: string
  rows: number
  skippedNotImported: number
  skippedAlreadyExported: number
  duplicatesMerged: number
}

/**
 * Файл «Загрузка пользователей» для LMS из того же файла заказов.
 *
 * Берутся только заказы, которые уже загружены (`apply`): файл LMS — следствие
 * учтённого набора, а не обход его. Один человек — одна строка, даже если он
 * записался на два курса: в LMS это одна учётная запись. `scope=new` отбрасывает
 * тех, кто уже уходил в LMS прошлым файлом, — по HMAC, без хранения адресов.
 */
export async function buildLmsFile(
  user: CurrentUser,
  query: LmsFileQuery,
  items: readonly unknown[],
  now: Date = new Date(),
): Promise<LmsFileResult> {
  assertCanImportOrders(user)
  const plan = await planOrders(items)

  let candidates = plan.orders.filter((order) => plan.existing.has(order.orderNo))
  const skippedNotImported = plan.orders.filter((order) => plan.courseOf.has(order.courseKey)).length - candidates.length

  if (query.courseId) {
    candidates = candidates.filter((order) => plan.existing.get(order.orderNo)!.courseId === query.courseId)
  }
  if (query.stream !== undefined) {
    candidates = candidates.filter((order) => plan.existing.get(order.orderNo)!.stream?.number === query.stream)
  }

  // Один человек — одна строка: общая почта или телефон связывают заказы.
  const index = new ListenerIndex()
  for (const order of candidates) index.add([order.emailHash, order.phoneHash])

  let exportedPersons = new Set<string>()
  if (query.scope === 'new') {
    const hashes = [...new Set(candidates.flatMap((order) => [order.emailHash, order.phoneHash]).filter((h): h is string => h !== null))]
    const exported = (await repo.findOrdersByHashes(hashes)).filter((row) => row.lmsExportedAt !== null)
    const exportedHashes = new Set(exported.flatMap((row) => [row.emailHash, row.phoneHash]).filter((h): h is string => h !== null))
    exportedPersons = new Set(
      candidates
        .filter((order) => exportedHashes.has(order.emailHash) || (order.phoneHash !== null && exportedHashes.has(order.phoneHash)))
        .map((order) => index.personOf([order.emailHash, order.phoneHash])!),
    )
  }

  const picked = new Map<string, ParsedOrder>()
  const includedOrderNos: string[] = []
  let skippedAlreadyExported = 0
  for (const order of candidates) {
    const person = index.personOf([order.emailHash, order.phoneHash])!
    if (exportedPersons.has(person)) {
      skippedAlreadyExported += 1
      continue
    }
    includedOrderNos.push(order.orderNo)
    if (!picked.has(person)) picked.set(person, order)
  }

  if (picked.size === 0) {
    throw validationError('В файл для LMS некого включить', [
      {
        field: 'file',
        message:
          skippedAlreadyExported > 0
            ? `Все ${skippedAlreadyExported} подходящих заказа уже уходили в LMS. Повторить файл — scope=all`
            : skippedNotImported > 0
              ? 'Заказы из файла ещё не загружены — сначала загрузите их (mode=apply)'
              : 'В файле нет заказов без ошибок по выбранному курсу и потоку',
      },
    ])
  }

  // Порядок — как в выгрузке сайта: методисту проще сверить файл LMS с исходным.
  const rows: LmsUserRow[] = [...picked.values()].map((order) => ({
    lastName: order.lastName,
    firstName: order.firstName,
    middleName: order.middleName,
    phoneDigits: order.phoneDigits,
    email: order.email,
  }))

  const file = buildLmsUsersFile(rows, now)
  await repo.markExportedToLms(includedOrderNos, now)
  await writeAudit({
    userId: user.id,
    action: 'export.lms_users',
    objectType: 'Export',
    objectId: 'lms-users',
    payload: {
      rows: rows.length,
      scope: query.scope,
      courseId: query.courseId ?? null,
      stream: query.stream ?? null,
      skippedNotImported,
      skippedAlreadyExported,
      duplicatesMerged: includedOrderNos.length - rows.length,
    },
  })

  return {
    file,
    fileName: lmsUsersFileName(now),
    rows: rows.length,
    skippedNotImported,
    skippedAlreadyExported,
    duplicatesMerged: includedOrderNos.length - rows.length,
  }
}

// ─────────────────────────── Курсы и показатели набора ───────────────────────────

function toCourseDto(row: repo.CourseRow): SchoolCourseDto {
  const streams = row.streams.map((stream) => {
    const orders = row.orders.filter((order) => order.streamId === stream.id)
    return {
      id: stream.id,
      number: stream.number,
      startsAt: toIso(stream.startsAt),
      orderCount: orders.length,
      listenerCount: countListeners(orders),
    }
  })
  const dates = row.orders.map((order) => order.orderedAt).filter((date): date is Date => date !== null)
  const last = dates.length > 0 ? new Date(Math.max(...dates.map((date) => date.getTime()))) : null
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    product: row.product
      ? {
          id: row.product.id,
          name: row.product.name,
          vendorId: row.product.vendor?.id ?? null,
          vendorName: row.product.vendor?.name ?? null,
        }
      : null,
    orderCount: row.orders.length,
    listenerCount: countListeners(row.orders),
    streamCount: row.streams.length,
    streams,
    lastOrderAt: toIso(last),
    isMock: row.isMock,
  }
}

/** Курсы ИТ-Школы с показателями набора: заявки, слушатели, группы (раздел 7.4 ТЗ). */
export async function listCourses(
  user: CurrentUser,
  query: SchoolCourseListQuery,
): Promise<{ data: SchoolCourseDto[]; meta: PageMeta & { totals: SchoolCoursesTotalsDto } }> {
  assertCan(user, 'VENDORS')
  const [{ rows, total }, hashes, streamCount] = await Promise.all([
    repo.findCourses(query),
    repo.findAllOrderHashes(),
    repo.countStreams(),
  ])
  return {
    data: rows.map(toCourseDto),
    meta: {
      ...pageMeta(query, total),
      totals: { orderCount: hashes.length, listenerCount: countListeners(hashes), streamCount },
    },
  }
}

/** Завести курс ИТ-Школы: без него заказы с сайта по этому курсу не загрузятся. */
export async function createCourse(user: CurrentUser, input: CreateSchoolCourseInput): Promise<SchoolCourseDto> {
  assertCan(user, 'WRITE')
  const nameKey = catalogNameKey(input.name)
  if (nameKey === '') throw validationError('Название курса пустое', [{ field: 'name', message: 'Укажите название' }])
  const same = await repo.findCourseByKey(nameKey)
  if (same) {
    throw conflict(`Курс «${same.name}» уже есть — названия совпадают без учёта регистра, пробелов и кавычек`, [
      { field: 'name', message: 'Курс с таким названием уже есть' },
    ])
  }
  if (input.productId && !(await repo.productExists(input.productId))) {
    throw notFound('IT-продукт не найден')
  }
  let row: repo.CourseRow
  try {
    row = await repo.createCourse({
      name: input.name,
      nameKey,
      description: input.description ?? null,
      productId: input.productId ?? null,
      isMock: false,
    })
  } catch (error) {
    // Параллельный запрос успел завести курс с тем же ключом — тот же отказ.
    if ((error as { code?: unknown })?.code === 'P2002') {
      throw conflict('Курс с таким названием уже есть', [{ field: 'name', message: 'Курс с таким названием уже есть' }])
    }
    throw error
  }
  await writeAudit({
    userId: user.id,
    action: 'school_course.create',
    objectType: 'SchoolCourse',
    objectId: row.id,
    payload: { fields: Object.keys(input) },
  })
  return toCourseDto(row)
}
