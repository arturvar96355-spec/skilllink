import { createHmac } from 'node:crypto'
import { ORDER_NUMBER_UTC_OFFSET_MINUTES } from '@/shared/config/enrollment.config'
import type { ImportIssueDto } from '@/shared/contracts/enrollment'
import {
  catalogNameKey,
  isPlausibleNamePart,
  isValidEmail,
  normalizeEmail,
  normalizeNamePart,
  normalizeRuPhoneDigits,
} from '@/shared/utils/contacts'

/**
 * Правила загрузки заказов с сайта (решение 132). Чистые функции: персональные
 * данные слушателя живут только здесь, в памяти запроса, и в базу не попадают.
 */

// ─────────────────────────── Номер заявки ───────────────────────────

export interface OrderNumberCheck {
  /** Дата-время заказа из номера (UTC); null — разобрать не удалось. */
  orderedAt: Date | null
  /** Что не так с номером — предупреждение, а не ошибка: номер остаётся ключом заказа. */
  problem: string | null
}

const DATE_PARTS = ['месяц', 'день', 'час', 'минуты', 'секунды'] as const

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/**
 * Номер заявки сайта: `ORD-ГГГГММДДЧЧММСС-XXXXXX`.
 *
 * Дата разбирается с проверкой календаря: у организаторов встречаются номера
 * с 15 цифрами, месяцем 17 и секундами 69. Такой номер — всё ещё уникальный
 * ключ заказа (по нему повторная загрузка узнаёт уже загруженное), но дата из него
 * не берётся: `orderedAt = null` и предупреждение в отчёте.
 */
export function parseOrderNumber(orderNo: string, now: Date = new Date()): OrderNumberCheck {
  const match = /^ORD-(\d+)-([A-Z0-9]+)$/i.exec(orderNo)
  if (!match) {
    return { orderedAt: null, problem: 'Номер не в формате ORD-ГГГГММДДЧЧММСС-XXXXXX — дата не разобрана' }
  }
  const digits = match[1]!
  const suffix = match[2]!
  if (digits.length !== 14) {
    return {
      orderedAt: null,
      problem: `В дате номера ${digits.length} цифр вместо 14 — дата не разобрана`,
    }
  }

  const [year, month, day, hour, minute, second] = [
    digits.slice(0, 4),
    digits.slice(4, 6),
    digits.slice(6, 8),
    digits.slice(8, 10),
    digits.slice(10, 12),
    digits.slice(12, 14),
  ].map(Number) as [number, number, number, number, number, number]

  const bad: string[] = []
  if (year < 2000 || year > 2100) bad.push(`год ${year}`)
  if (month < 1 || month > 12) bad.push(`${DATE_PARTS[0]} ${month}`)
  else if (day < 1 || day > daysInMonth(year, month)) bad.push(`${DATE_PARTS[1]} ${day}`)
  if (hour > 23) bad.push(`${DATE_PARTS[2]} ${hour}`)
  if (minute > 59) bad.push(`${DATE_PARTS[3]} ${minute}`)
  if (second > 59) bad.push(`${DATE_PARTS[4]} ${second}`)
  if (bad.length > 0) {
    return { orderedAt: null, problem: `Несуществующая дата в номере: ${bad.join(', ')} — дата не разобрана` }
  }

  const utc = Date.UTC(year, month - 1, day, hour, minute, second) - ORDER_NUMBER_UTC_OFFSET_MINUTES * 60_000
  const orderedAt = new Date(utc)
  if (orderedAt.getTime() > now.getTime() + 24 * 3600_000) {
    return { orderedAt, problem: 'Дата в номере — в будущем' }
  }
  if (suffix.length !== 6) {
    return { orderedAt, problem: `Код после даты из ${suffix.length} знаков вместо 6` }
  }
  return { orderedAt, problem: null }
}

// ─────────────────────────── HMAC ───────────────────────────

/**
 * HMAC-SHA256 от нормализованной почты или телефона. Префикс «email:» / «phone:»
 * разводит пространства: строка, которая оказалась бы и почтой, и телефоном,
 * не даст одинаковых хешей.
 */
export function contactHash(key: string, kind: 'email' | 'phone', value: string): string {
  return createHmac('sha256', key).update(`${kind}:${value}`, 'utf8').digest('hex')
}

// ─────────────────────────── Разбор файла ───────────────────────────

/** Колонки заказа — ключи объекта в выгрузке сайта. */
export const ORDER_FIELDS = {
  orderNo: 'Номер заявки',
  course: 'Курс',
  lastName: 'Фамилия',
  firstName: 'Имя',
  middleName: 'Отчество',
  phone: 'Телефон',
  email: 'Email',
  stream: 'Номер потока',
} as const

/** Заказ после проверки и нормализации. ПД — только в памяти запроса. */
export interface ParsedOrder {
  /** Номер элемента массива, с единицы — как его найти в файле. */
  row: number
  orderNo: string
  courseName: string
  courseKey: string
  streamNumber: number | null
  lastName: string
  firstName: string
  middleName: string | null
  phoneDigits: string | null
  email: string
  emailHash: string
  phoneHash: string | null
  orderedAt: Date | null
}

export interface OrdersQuality {
  totalItems: number
  emptyItemsSkipped: number
  phonesNormalized: number
  emailsLowercased: number
  namesFixed: number
  brokenOrderNumbers: number
  duplicateOrderNumbersInFile: number
  /** Тот же слушатель (совпала почта или телефон) на тот же курс и поток — повторная заявка. */
  duplicateListenersInFile: number
}

export interface OrdersAnalysis {
  orders: ParsedOrder[]
  errors: ImportIssueDto[]
  warnings: ImportIssueDto[]
  quality: OrdersQuality
}

function text(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

function streamNumber(value: unknown): number | null | 'invalid' {
  if (value === null || value === undefined || value === '') return null
  const number = typeof value === 'number' ? value : Number(String(value).trim())
  if (!Number.isInteger(number) || number < 1 || number > 10_000) return 'invalid'
  return number
}

function checkName(
  raw: unknown,
  column: string,
  row: number,
  required: boolean,
  errors: ImportIssueDto[],
): { value: string | null; fixed: boolean } {
  const original = text(raw)
  if (!original) {
    if (required) errors.push({ row, column, message: 'Не заполнено' })
    return { value: null, fixed: false }
  }
  const value = normalizeNamePart(original)!
  if (!isPlausibleNamePart(value)) {
    // Значение не повторяем: это персональные данные, отчёт уходит в браузер и журнал ошибок фронта.
    errors.push({ row, column, message: 'Содержит цифры или знаки, которых в имени не бывает' })
    return { value: null, fixed: false }
  }
  return { value, fixed: value !== original }
}

/**
 * Разбор выгрузки заказов с сайта: массив объектов, `null` пропускается.
 *
 * Строка с ошибкой (нет номера, фамилии, имени, почты; почта или телефон не
 * распознаны; номер потока не число) в загрузку и в файл LMS не идёт — остальные идут.
 * Битая дата в номере — предупреждение. Сообщения не повторяют ни ФИО, ни почту,
 * ни телефон: отчёт — это то, что видит браузер, а не файл.
 */
export function analyzeOrders(items: readonly unknown[], hmacKey: string, now: Date = new Date()): OrdersAnalysis {
  const errors: ImportIssueDto[] = []
  const warnings: ImportIssueDto[] = []
  const quality: OrdersQuality = {
    totalItems: items.length,
    emptyItemsSkipped: 0,
    phonesNormalized: 0,
    emailsLowercased: 0,
    namesFixed: 0,
    brokenOrderNumbers: 0,
    duplicateOrderNumbersInFile: 0,
    duplicateListenersInFile: 0,
  }
  const orders: ParsedOrder[] = []
  const seenOrderNo = new Map<string, number>()

  items.forEach((item, index) => {
    const row = index + 1
    if (item === null || item === undefined) {
      quality.emptyItemsSkipped += 1
      return
    }
    if (typeof item !== 'object' || Array.isArray(item)) {
      errors.push({ row, column: '—', message: 'Ожидался объект заказа' })
      return
    }
    const record = item as Record<string, unknown>
    if (Object.values(record).every((value) => text(value) === null)) {
      quality.emptyItemsSkipped += 1
      return
    }
    const rowErrors: ImportIssueDto[] = []

    const orderNo = text(record[ORDER_FIELDS.orderNo])
    if (!orderNo) rowErrors.push({ row, column: ORDER_FIELDS.orderNo, message: 'Не заполнен номер заявки' })
    else if (orderNo.length > 64) rowErrors.push({ row, column: ORDER_FIELDS.orderNo, message: 'Номер длиннее 64 знаков' })

    const courseName = text(record[ORDER_FIELDS.course])
    if (!courseName) rowErrors.push({ row, column: ORDER_FIELDS.course, message: 'Не указан курс' })

    const last = checkName(record[ORDER_FIELDS.lastName], ORDER_FIELDS.lastName, row, true, rowErrors)
    const first = checkName(record[ORDER_FIELDS.firstName], ORDER_FIELDS.firstName, row, true, rowErrors)
    const middle = checkName(record[ORDER_FIELDS.middleName], ORDER_FIELDS.middleName, row, false, rowErrors)

    const rawEmail = text(record[ORDER_FIELDS.email])
    const email = normalizeEmail(rawEmail)
    if (!email) rowErrors.push({ row, column: ORDER_FIELDS.email, message: 'Не заполнена почта — без неё не создать учётную запись в LMS' })
    else if (!isValidEmail(email)) rowErrors.push({ row, column: ORDER_FIELDS.email, message: 'Адрес не похож на почту' })

    const rawPhone = text(record[ORDER_FIELDS.phone])
    const phoneDigits = normalizeRuPhoneDigits(rawPhone)
    if (rawPhone && !phoneDigits) {
      rowErrors.push({ row, column: ORDER_FIELDS.phone, message: 'Номер не распознан: нужен российский номер из 10–11 цифр' })
    } else if (!rawPhone) {
      warnings.push({ row, column: ORDER_FIELDS.phone, message: 'Телефон не указан — в файле LMS колонка останется пустой' })
    }

    const stream = streamNumber(record[ORDER_FIELDS.stream])
    if (stream === 'invalid') {
      rowErrors.push({ row, column: ORDER_FIELDS.stream, message: 'Номер потока — целое число от 1' })
    } else if (stream === null) {
      warnings.push({ row, column: ORDER_FIELDS.stream, message: 'Поток не указан — заказ учтётся по курсу без потока' })
    }

    if (orderNo && seenOrderNo.has(orderNo)) {
      quality.duplicateOrderNumbersInFile += 1
      rowErrors.push({
        row,
        column: ORDER_FIELDS.orderNo,
        message: `Номер ${orderNo} уже встречался в файле (элемент ${seenOrderNo.get(orderNo)})`,
      })
    }

    if (rowErrors.length > 0) {
      errors.push(...rowErrors)
      if (orderNo && !seenOrderNo.has(orderNo)) seenOrderNo.set(orderNo, row)
      return
    }
    seenOrderNo.set(orderNo!, row)

    // Счётчики исправлений — только у принятых строк: «исправлено» значит «ушло исправленным».
    if (rawPhone && phoneDigits && rawPhone !== phoneDigits) quality.phonesNormalized += 1
    if (rawEmail && email && rawEmail !== email) quality.emailsLowercased += 1
    if (last.fixed || first.fixed || middle.fixed) quality.namesFixed += 1

    const check = parseOrderNumber(orderNo!, now)
    if (check.problem) {
      if (check.orderedAt === null) quality.brokenOrderNumbers += 1
      warnings.push({ row, column: ORDER_FIELDS.orderNo, message: `${orderNo}: ${check.problem}` })
    }

    orders.push({
      row,
      orderNo: orderNo!,
      courseName: courseName!,
      courseKey: catalogNameKey(courseName!),
      streamNumber: stream as number | null,
      lastName: last.value!,
      firstName: first.value!,
      middleName: middle.value,
      phoneDigits,
      email: email!,
      emailHash: contactHash(hmacKey, 'email', email!),
      phoneHash: phoneDigits ? contactHash(hmacKey, 'phone', phoneDigits) : null,
      orderedAt: check.orderedAt,
    })
  })

  // Повторная заявка того же человека на тот же курс и поток: заказ остаётся заказом
  // (показатель «заявки»), но слушатель — один (показатель «слушатели», файл LMS).
  const listeners = new ListenerIndex()
  for (const order of orders) listeners.add([order.emailHash, order.phoneHash])
  const seenInStream = new Map<string, number>()
  for (const order of orders) {
    const person = listeners.personOf([order.emailHash, order.phoneHash])
    const key = `${order.courseKey}#${order.streamNumber ?? '-'}#${person}`
    const first = seenInStream.get(key)
    if (first !== undefined) {
      quality.duplicateListenersInFile += 1
      warnings.push({
        row: order.row,
        column: ORDER_FIELDS.email,
        message: `Тот же слушатель уже записан на этот курс и поток (элемент ${first}): заказ учтётся, в файл LMS человек попадёт один раз`,
      })
    } else {
      seenInStream.set(key, order.row)
    }
  }

  return { orders, errors, warnings, quality }
}

// ─────────────────────────── Слушатели ───────────────────────────

/**
 * Один человек — все заказы, связанные общей почтой или общим телефоном
 * (объединение множеств): «та же почта, другой телефон» и «тот же телефон,
 * другая почта» — один слушатель.
 */
export class ListenerIndex {
  private readonly parent = new Map<string, string>()

  private find(key: string): string {
    let root = key
    while (this.parent.get(root) !== root) root = this.parent.get(root)!
    let node = key
    while (node !== root) {
      const next = this.parent.get(node)!
      this.parent.set(node, root)
      node = next
    }
    return root
  }

  /** Добавляет ключи одного заказа и возвращает идентификатор человека на данный момент. */
  add(keys: ReadonlyArray<string | null>): string {
    const present = keys.filter((key): key is string => key !== null)
    for (const key of present) if (!this.parent.has(key)) this.parent.set(key, key)
    const [head, ...rest] = present
    if (!head) throw new Error('У заказа нет ни почты, ни телефона')
    for (const key of rest) {
      const a = this.find(head)
      const b = this.find(key)
      if (a !== b) this.parent.set(b, a)
    }
    return this.find(head)
  }

  /** Идентификатор человека по одному из ключей (после всех add). */
  personOf(keys: ReadonlyArray<string | null>): string | null {
    const key = keys.find((item): item is string => item !== null && this.parent.has(item))
    return key ? this.find(key) : null
  }
}

/** Сколько разных людей среди заказов. */
export function countListeners(orders: ReadonlyArray<{ emailHash: string | null; phoneHash: string | null }>): number {
  const index = new ListenerIndex()
  for (const order of orders) {
    if (order.emailHash || order.phoneHash) index.add([order.emailHash, order.phoneHash])
  }
  return new Set(orders.map((order) => index.personOf([order.emailHash, order.phoneHash])).filter(Boolean)).size
}
