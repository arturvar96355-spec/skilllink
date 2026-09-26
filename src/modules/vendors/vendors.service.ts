import { notFound, validationError } from '@/shared/http/errors'
import { assertCan, can } from '@/shared/auth/permissions'
import { writeAudit } from '@/shared/audit/audit'
import { pageMeta } from '@/shared/http/pagination'
import { toIsoRequired } from '@/shared/utils/date'
import { readXlsx } from '@/shared/files/xlsx'
import { looksLikeZip } from '@/shared/files/zip'
import {
  catalogNameKey,
  formatPhoneE164,
  isValidEmail,
  normalizeEmail,
  normalizeRuPhoneDigits,
} from '@/shared/utils/contacts'
import { MAX_VENDOR_ROWS, VENDOR_IMPORT_DEFAULT_CATEGORY } from '@/shared/config/enrollment.config'
import type { CurrentUser } from '@/shared/auth/current-user'
import type { PageMeta } from '@/shared/contracts/common'
import type { ImportIssueDto } from '@/shared/contracts/enrollment'
import type { VendorContactChannel } from '@/shared/contracts/enums'
import type {
  VendorContactDto,
  VendorDto,
  VendorImportResultDto,
  VendorListItemDto,
} from '@/shared/contracts/vendor'
import { decodeCsv } from '@/modules/import/decode'
import { cell, detectDelimiter, mapHeaders, parseCsv, type CsvRow } from '@/modules/import/import.rules'
import {
  VENDOR_COLUMNS,
  contactKey,
  normalizeFullName,
  parseChannels,
  parseProductCell,
  sameChannels,
} from './vendors.rules'
import type { VendorImportQuery, VendorListQuery } from './vendors.schema'
import * as repo from './vendors.repo'

// ─────────────────────────── Реестр и карточка ───────────────────────────

function toListItem(row: repo.VendorListRow): VendorListItemDto {
  return {
    id: row.id,
    name: row.name,
    products: row.products.map((product) => ({ id: product.id, name: product.name, status: product.status })),
    contactCount: row._count.contacts,
    cooperationCount: row.products.reduce((sum, product) => sum + product._count.cooperations, 0),
    isMock: row.isMock,
    updatedAt: toIsoRequired(row.updatedAt),
  }
}

export async function list(
  user: CurrentUser,
  query: VendorListQuery,
): Promise<{ data: VendorListItemDto[]; meta: PageMeta }> {
  assertCan(user, 'VENDORS')
  const { rows, total } = await repo.findMany(query)
  return { data: rows.map(toListItem), meta: pageMeta(query, total) }
}

function toContactDto(contact: repo.VendorDetailRow['contacts'][number], showDetails: boolean): VendorContactDto {
  return {
    id: contact.id,
    fullName: contact.fullName,
    email: showDetails ? contact.email : null,
    phone: showDetails ? contact.phone : null,
    preferredChannels: contact.preferredChannels,
    productIds: contact.products.map((link) => link.productId),
    legalBasis: contact.legalBasis,
    contactDetailsHidden: !showDetails && (contact.email !== null || contact.phone !== null),
  }
}

/**
 * Карточка вендора: продукты, контакты, связки через продукты, курсы на базе продуктов.
 * Почта и телефон контактов — только с правом CONTACT_DETAILS (решение 106), как у вузов.
 */
export async function getById(user: CurrentUser, id: string): Promise<VendorDto> {
  assertCan(user, 'VENDORS')
  const row = await repo.findById(id)
  if (!row) throw notFound('Вендор не найден')
  const showDetails = can(user, 'CONTACT_DETAILS')
  return {
    id: row.id,
    name: row.name,
    products: row.products.map((product) => ({
      id: product.id,
      name: product.name,
      category: product.category,
      version: product.version,
      status: product.status,
      cooperationCount: product._count.cooperations,
    })),
    contacts: row.contacts.map((contact) => toContactDto(contact, showDetails)),
    cooperations: row.products.flatMap((product) =>
      product.cooperations.map((cooperation) => ({
        id: cooperation.id,
        status: cooperation.status,
        universityId: cooperation.university.id,
        universityName: cooperation.university.name,
        programId: cooperation.program.id,
        programName: cooperation.program.name,
        productId: product.id,
        productName: product.name,
      })),
    ),
    courses: row.products.flatMap((product) => product.schoolCourses),
    isMock: row.isMock,
    createdAt: toIsoRequired(row.createdAt),
    updatedAt: toIsoRequired(row.updatedAt),
  }
}

// ─────────────────────────── Загрузка ───────────────────────────

interface Table {
  format: 'xlsx' | 'csv'
  encoding: 'utf-8' | 'windows-1251' | null
  sheet: string | null
  rows: CsvRow[]
}

/** Файл — книга Excel (по подписи ZIP) или CSV. Первый лист с данными. */
export function readTable(bytes: Uint8Array): Table {
  if (looksLikeZip(bytes)) {
    const sheets = readXlsx(bytes)
    const sheet = sheets.find((item) => item.rows.some((row) => row.some((value) => value.trim() !== ''))) ?? sheets[0]!
    return { format: 'xlsx', encoding: null, sheet: sheet.name, rows: sheet.rows }
  }
  const { text, encoding } = decodeCsv(bytes)
  return { format: 'csv', encoding, sheet: null, rows: parseCsv(text, detectDelimiter(text)) }
}

const isEmptyRow = (row: CsvRow | undefined): boolean => !row || row.every((value) => value.trim() === '')

interface ContactPlan {
  vendorRef: string
  vendorName: string
  vendorExistingId: string | null
  fullName: string
  email: string | null
  phone: string | null
  channels: VendorContactChannel[]
  productRefs: Set<string>
  firstRow: number
}

/** Загружать вендоров могут роли с правом записи — как реестры. Проверка до чтения файла. */
export function assertCanImportVendors(user: CurrentUser): void {
  assertCan(user, 'WRITE')
}

/**
 * Загрузка вендоров, их продуктов и контактов из файла организаторов (xlsx или CSV).
 *
 * Вендор и продукт узнаются по ключу названия (без кавычек, регистра и пробелов):
 * повторная загрузка того же файла ничего не создаёт. Недостающий продукт заводится
 * со статусом ACTIVE и категорией по умолчанию. Продукт, уже привязанный к другому
 * вендору, не перепривязывается — это ошибка строки: смена вендора — решение человека.
 * Контакт узнаётся по вендору и ФИО; пустая ячейка телефона или почты не стирает
 * записанное раньше (как в загрузке реестров).
 */
export async function importVendors(
  user: CurrentUser,
  query: VendorImportQuery,
  bytes: Uint8Array,
  now: Date = new Date(),
): Promise<VendorImportResultDto> {
  assertCanImportVendors(user)
  if (bytes.length === 0) throw validationError('Файл пуст', [{ field: 'file', message: 'Передайте содержимое файла' }])

  const table = readTable(bytes)
  const headerIndex = table.rows.findIndex((row) => !isEmptyRow(row))
  if (headerIndex < 0) throw validationError('Файл пуст', [{ field: 'file', message: 'Нет ни одной заполненной строки' }])
  const index = mapHeaders(table.rows[headerIndex]!, VENDOR_COLUMNS.required, VENDOR_COLUMNS.optional)
  const dataRows = table.rows.length - headerIndex - 1
  if (dataRows > MAX_VENDOR_ROWS) {
    throw validationError(`За один раз принимается не больше ${MAX_VENDOR_ROWS} строк`, [
      { field: 'file', message: `В файле ${dataRows} строк` },
    ])
  }

  const catalog = await repo.loadCatalog()
  const vendorByKey = new Map<string, { ref: string; name: string; existingId: string | null }>()
  for (const vendor of catalog.vendors) vendorByKey.set(vendor.nameKey, { ref: vendor.id, name: vendor.name, existingId: vendor.id })
  const productByKey = new Map<string, (typeof catalog.products)[number]>()
  for (const product of catalog.products) {
    const key = catalogNameKey(product.name)
    if (!productByKey.has(key)) productByKey.set(key, product)
  }
  /** Продукты, уже разобранные в этом файле: ключ → ссылка и вендор. */
  const plannedProducts = new Map<string, { ref: string; vendorRef: string; vendorName: string }>()
  const contacts = new Map<string, ContactPlan>()

  const errors: ImportIssueDto[] = []
  const warnings: ImportIssueDto[] = []
  const result: VendorImportResultDto = {
    mode: query.mode,
    format: table.format,
    encoding: table.encoding,
    sheet: table.sheet,
    totalRows: 0,
    toCreate: { vendors: [], products: [], contacts: [] },
    toUpdate: { products: [], contacts: [] },
    unchanged: { products: 0, contacts: 0 },
    errors,
    warnings,
    quality: { phonesNormalized: 0, emailsLowercased: 0, multiProductCells: 0, productsMatched: 0 },
    processedAt: now.toISOString(),
  }
  const vendorSteps: repo.VendorImportStep[] = []
  const productSteps: repo.VendorImportStep[] = []
  let newRefs = 0

  for (let i = headerIndex + 1; i < table.rows.length; i += 1) {
    const row = table.rows[i]!
    if (isEmptyRow(row)) continue
    const line = i + 1
    result.totalRows += 1
    const rowErrors: ImportIssueDto[] = []

    const company = cell(row, index, 'Компания')?.replace(/\s+/g, ' ') ?? null
    const vendorKey = company ? catalogNameKey(company) : ''
    if (!company || vendorKey === '') rowErrors.push({ row: line, column: 'Компания', message: 'Не заполнена компания' })

    const productCell = cell(row, index, 'Продукт')
    const productNames = parseProductCell(productCell)
    if (productNames.length > 1) result.quality.multiProductCells += 1
    const tooLong = productNames.find((name) => name.length > 200 || name.length < 2)
    if (tooLong !== undefined) rowErrors.push({ row: line, column: 'Продукт', message: 'Название продукта — от 2 до 200 знаков' })

    const fullName = normalizeFullName(cell(row, index, 'ФИО'))
    if (fullName && fullName.length > 200) rowErrors.push({ row: line, column: 'ФИО', message: 'ФИО длиннее 200 знаков' })

    const phoneRaw = cell(row, index, 'Телефон')
    const phoneDigits = normalizeRuPhoneDigits(phoneRaw)
    if (phoneRaw && !phoneDigits) {
      rowErrors.push({ row: line, column: 'Телефон', message: 'Номер не распознан: нужен российский номер из 10–11 цифр' })
    }
    const phone = phoneDigits ? formatPhoneE164(phoneDigits) : null

    const emailRaw = cell(row, index, 'Почта')
    const email = normalizeEmail(emailRaw)
    if (email && !isValidEmail(email)) rowErrors.push({ row: line, column: 'Почта', message: 'Адрес не похож на почту' })

    const { channels, unknown } = parseChannels(cell(row, index, 'Способ связи'))
    if (unknown.length > 0) {
      rowErrors.push({
        row: line,
        column: 'Способ связи',
        message: `Неизвестный способ связи: ${unknown.join(', ')}. Допустимы: Почта, Чат в ТГ, Телефон`,
      })
    }
    if (!fullName && (phone || email)) {
      rowErrors.push({ row: line, column: 'ФИО', message: 'Телефон или почта есть, а ФИО нет — чей это контакт?' })
    }

    if (rowErrors.length > 0) {
      errors.push(...rowErrors)
      continue
    }

    // ── Вендор: новый регистрируется, только если строка принята целиком.
    const knownVendor = vendorByKey.get(vendorKey)
    const vendor = knownVendor ?? { ref: `new:vendor:${(newRefs += 1)}`, name: company!, existingId: null }

    // ── Продукты: сначала проверка всей ячейки, потом запись в план.
    const productRefs: string[] = []
    const productErrors: ImportIssueDto[] = []
    const pendingSteps: repo.VendorImportStep[] = []
    const pendingPlanned: Array<[string, { ref: string; vendorRef: string; vendorName: string }]> = []
    const pendingCreated: string[] = []
    const pendingLinked: Array<{ name: string; change: string }> = []
    let matched = 0
    let unchangedProducts = 0
    for (const name of productNames) {
      const key = catalogNameKey(name)
      const planned = plannedProducts.get(key) ?? pendingPlanned.find(([k]) => k === key)?.[1]
      if (planned) {
        if (planned.vendorRef !== vendor.ref) {
          productErrors.push({
            row: line,
            column: 'Продукт',
            message: `«${name}» в этом файле уже указан у вендора ${planned.vendorName}`,
          })
        } else if (!productRefs.includes(planned.ref)) {
          productRefs.push(planned.ref)
        }
        continue
      }
      const existing = productByKey.get(key)
      if (existing) {
        matched += 1
        if (existing.vendorId !== null && existing.vendorId !== vendor.existingId) {
          productErrors.push({
            row: line,
            column: 'Продукт',
            message: `«${existing.name}» уже привязан к вендору ${existing.vendor?.name ?? '—'} — смените вендора в карточке продукта`,
          })
          continue
        }
        if (existing.vendorId === null) {
          pendingSteps.push({ kind: 'product-link', productId: existing.id, vendorRef: vendor.ref })
          pendingLinked.push({ name: existing.name, change: `Будет привязан к вендору ${vendor.name}` })
        } else {
          unchangedProducts += 1
        }
        pendingPlanned.push([key, { ref: existing.id, vendorRef: vendor.ref, vendorName: vendor.name }])
        productRefs.push(existing.id)
        continue
      }
      const ref = `new:product:${(newRefs += 1)}`
      pendingSteps.push({ kind: 'product-create', ref, name, category: VENDOR_IMPORT_DEFAULT_CATEGORY, vendorRef: vendor.ref })
      pendingPlanned.push([key, { ref, vendorRef: vendor.ref, vendorName: vendor.name }])
      pendingCreated.push(name)
      productRefs.push(ref)
    }
    if (productErrors.length > 0) {
      errors.push(...productErrors)
      continue
    }

    if (!knownVendor) {
      vendorByKey.set(vendorKey, vendor)
      vendorSteps.push({ kind: 'vendor', ref: vendor.ref, name: vendor.name, nameKey: vendorKey })
      result.toCreate.vendors.push(vendor.name)
    }
    productSteps.push(...pendingSteps)
    for (const [key, value] of pendingPlanned) plannedProducts.set(key, value)
    result.toCreate.products.push(...pendingCreated)
    result.toUpdate.products.push(...pendingLinked)
    result.quality.productsMatched += matched
    result.unchanged.products += unchangedProducts

    if (phoneRaw && phone && phoneRaw !== phone) result.quality.phonesNormalized += 1
    if (emailRaw && email && emailRaw !== email) result.quality.emailsLowercased += 1

    // ── Контакт
    if (!fullName) continue
    if (channels.includes('TELEGRAM') && !phone) {
      warnings.push({ row: line, column: 'Способ связи', message: 'Чат в ТГ, но телефона нет: в файле нет ника — найти человека в Telegram не по чему' })
    }
    if (!phone && !email) warnings.push({ row: line, column: 'ФИО', message: 'У контакта нет ни телефона, ни почты' })

    const key = contactKey(vendorKey, fullName)
    const planned = contacts.get(key)
    if (planned) {
      // Тот же человек во второй строке — обычно по другому продукту того же вендора.
      if ((phone && planned.phone && phone !== planned.phone) || (email && planned.email && email !== planned.email)) {
        errors.push({
          row: line,
          column: phone && planned.phone && phone !== planned.phone ? 'Телефон' : 'Почта',
          message: `Контакт «${fullName}» уже есть в строке ${planned.firstRow} с другими данными`,
        })
        continue
      }
      planned.phone ??= phone
      planned.email ??= email
      for (const channel of channels) if (!planned.channels.includes(channel)) planned.channels.push(channel)
      for (const ref of productRefs) planned.productRefs.add(ref)
      continue
    }
    contacts.set(key, {
      vendorRef: vendor.ref,
      vendorName: vendor.name,
      vendorExistingId: vendor.existingId,
      fullName,
      email,
      phone,
      channels: [...channels],
      productRefs: new Set(productRefs),
      firstRow: line,
    })
  }

  // ── Контакты: новые и изменённые
  const contactSteps: repo.VendorImportStep[] = []
  const basisReference = `Файл вендоров, загружен ${now.toISOString().slice(0, 10)}`
  for (const [key, plan] of contacts) {
    const existing = plan.vendorExistingId
      ? catalog.contacts.find(
          (contact) => contact.vendorId === plan.vendorExistingId && contactKey(key.split('::')[0]!, contact.fullName) === key,
        )
      : undefined
    if (!existing) {
      contactSteps.push({
        kind: 'contact-create',
        vendorRef: plan.vendorRef,
        fullName: plan.fullName,
        email: plan.email,
        phone: plan.phone,
        channels: plan.channels,
        productRefs: [...plan.productRefs],
        basisReference,
      })
      result.toCreate.contacts.push(plan.fullName)
      continue
    }
    const email = plan.email ?? existing.email
    const phone = plan.phone ?? existing.phone
    const channels = plan.channels.length > 0 ? plan.channels : existing.preferredChannels
    const productIds = new Set([...existing.products.map((link) => link.productId), ...plan.productRefs])
    const fields: string[] = []
    if (email !== existing.email) fields.push('Почта')
    if (phone !== existing.phone) fields.push('Телефон')
    if (!sameChannels(channels, existing.preferredChannels)) fields.push('Способ связи')
    if (productIds.size !== existing.products.length) fields.push('Продукты')
    if (fields.length === 0) {
      result.unchanged.contacts += 1
      continue
    }
    contactSteps.push({ kind: 'contact-update', contactId: existing.id, email, phone, channels, productRefs: [...productIds] })
    result.toUpdate.contacts.push({ fullName: existing.fullName, vendor: plan.vendorName, fields })
  }

  errors.sort((a, b) => a.row - b.row)
  warnings.sort((a, b) => a.row - b.row)

  if (query.mode === 'apply') {
    const steps = [...vendorSteps, ...productSteps, ...contactSteps]
    if (steps.length > 0) await repo.applyImport(steps)
    // В журнал — только счётчики: ни ФИО, ни почт, ни телефонов.
    await writeAudit({
      userId: user.id,
      action: 'import.vendors',
      objectType: 'Import',
      objectId: 'vendors',
      payload: {
        format: table.format,
        rows: result.totalRows,
        vendorsCreated: result.toCreate.vendors.length,
        productsCreated: result.toCreate.products.length,
        productsLinked: result.toUpdate.products.length,
        contactsCreated: result.toCreate.contacts.length,
        contactsUpdated: result.toUpdate.contacts.length,
        errors: new Set(errors.map((issue) => issue.row)).size,
      },
    })
  }

  return result
}
