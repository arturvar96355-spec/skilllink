import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CurrentUser } from '@/shared/auth/current-user'
import type { UserRole } from '@/shared/contracts/enums'
import { expectRejectCode } from '@/shared/testing/expect-code'
import { readXlsx } from '@/shared/files/xlsx'
import { catalogNameKey } from '@/shared/utils/contacts'

/**
 * Загрузка заказов с сайта и файл для LMS (решение 122). База подменена хранилищем
 * в памяти: проверяется то, что решает сервис, — идемпотентность, дедупликация по
 * HMAC, права и отсутствие ПД в ответе, журнале и «базе».
 */

interface StoredOrder {
  orderNo: string
  courseId: string
  streamNumber: number | null
  emailHash: string
  phoneHash: string | null
  orderedAt: Date | null
  lmsExportedAt: Date | null
  batchId: string
}

const store = vi.hoisted(() => ({
  courses: [] as Array<{ id: string; name: string; nameKey: string; streams: Array<{ id: string; number: number }> }>,
  orders: [] as StoredOrder[],
}))

const repo = vi.hoisted(() => ({
  findCoursesByKeys: vi.fn(async (keys: string[]) => store.courses.filter((course) => keys.includes(course.nameKey))),
  findOrdersByNumbers: vi.fn(async (numbers: string[]) =>
    store.orders
      .filter((order) => numbers.includes(order.orderNo))
      .map((order) => ({ ...order, stream: order.streamNumber === null ? null : { number: order.streamNumber } })),
  ),
  findOrdersByHashes: vi.fn(async (hashes: string[]) =>
    store.orders.filter((order) => hashes.includes(order.emailHash) || (order.phoneHash !== null && hashes.includes(order.phoneHash))),
  ),
  createOrders: vi.fn(async (orders: Array<Omit<StoredOrder, 'lmsExportedAt' | 'batchId'>>, batchId: string) => {
    let created = 0
    for (const order of orders) {
      if (store.orders.some((stored) => stored.orderNo === order.orderNo)) continue
      store.orders.push({ ...order, lmsExportedAt: null, batchId })
      created += 1
    }
    return created
  }),
  markExportedToLms: vi.fn(async (numbers: string[], at: Date) => {
    for (const order of store.orders) if (numbers.includes(order.orderNo)) order.lmsExportedAt = at
  }),
}))
const audit = vi.hoisted(() => ({ writeAudit: vi.fn() }))

vi.mock('./enrollment.repo', () => repo)
vi.mock('@/shared/audit/audit', () => audit)

const { importSiteOrders, buildLmsFile, parseOrdersBody, assertCanImportOrders } = await import('./enrollment.service')

const RAW = readFileSync(join(process.cwd(), 'tests/fixtures/site-orders.sample.json'))
const ITEMS = parseOrdersBody(RAW)

/** ПД из фикстуры: ни одно из этих значений не должно попасть в ответ, журнал и «базу». */
const PERSONAL = ['testova', 'TESTOVA', 'Тестова', 'Примеров', 'primerov', 'obrazcov', 'Образцов', '79000000101', '000-01-01', 'demo.dd@', 'Демо']

function user(role: UserRole): CurrentUser {
  return { id: `u-${role}`, email: `${role}@example.invalid`, fullName: 'Сотрудник', role, universityId: role === 'UNIVERSITY_REP' ? 'uni-1' : null }
}

const COURSE_NAMES = [
  'Анализ данных без программирования',
  'Инженер-тестировщик',
  'Управление ИТ-проектами на базе программного продукта ПАО «Ростелеком»',
  'Промпт-инжиниринг',
  'Python-разработчик с использованием инструментов ИИ',
]

beforeEach(() => {
  vi.clearAllMocks()
  store.orders = []
  store.courses = COURSE_NAMES.map((name, i) => ({
    id: `course-${i + 1}`,
    name,
    nameKey: catalogNameKey(name),
    streams: i === 0 ? [{ id: 's-1-1', number: 1 }] : [],
  }))
})

describe('загрузка заказов с сайта', () => {
  it('предпросмотр ничего не пишет и отчитывается о качестве данных', async () => {
    const result = await importSiteOrders(user('MANAGER'), { mode: 'preview' }, ITEMS)
    expect(repo.createOrders).not.toHaveBeenCalled()
    expect(audit.writeAudit).not.toHaveBeenCalled()
    expect(result.toCreate).toBe(6)
    expect(result.batchId).toBeNull()
    expect(result.quality).toMatchObject({
      totalItems: 10,
      emptyItemsSkipped: 1,
      validRows: 6,
      rowsWithErrors: 3,
      brokenOrderNumbers: 3,
      duplicateOrderNumbersInFile: 1,
      duplicateListenersInFile: 1,
      alreadyImported: 0,
      unknownCourses: [{ name: 'Курс, которого нет', rows: 1 }],
    })
    // Курс с прямыми кавычками в файле нашёлся по курсу с ёлочками в системе.
    expect(result.courses.some((course) => course.courseName.includes('Ростелеком'))).toBe(true)
    expect(result.quality.newStreams).toHaveLength(4)
  })

  it('apply записывает только хеши; повторная загрузка того же файла ничего не создаёт', async () => {
    const first = await importSiteOrders(user('MANAGER'), { mode: 'apply' }, ITEMS)
    expect(first.toCreate).toBe(6)
    expect(first.batchId).toMatch(/^[0-9a-f-]{36}$/)
    expect(store.orders).toHaveLength(6)
    for (const order of store.orders) {
      expect(order.emailHash).toMatch(/^[0-9a-f]{64}$/)
      expect(Object.keys(order).sort()).toEqual(
        ['batchId', 'courseId', 'emailHash', 'lmsExportedAt', 'orderNo', 'orderedAt', 'phoneHash', 'streamNumber'].sort(),
      )
    }

    const second = await importSiteOrders(user('MANAGER'), { mode: 'apply' }, ITEMS)
    expect(second.toCreate).toBe(0)
    expect(second.batchId).toBeNull()
    expect(second.quality.alreadyImported).toBe(6)
    expect(store.orders).toHaveLength(6)
  })

  it('слушатель из прошлой загрузки узнаётся по HMAC, хотя адреса в базе нет', async () => {
    await importSiteOrders(user('MANAGER'), { mode: 'apply' }, ITEMS.slice(0, 3))
    const next = await importSiteOrders(user('MANAGER'), { mode: 'preview' }, ITEMS)
    // Тестова (элемент 2) уже загружена; её заказы 6 и 7 — тот же человек.
    expect(next.quality.knownListeners).toBeGreaterThanOrEqual(1)
  })

  it('ни в ответе, ни в журнале, ни в «базе» нет ФИО, почт и телефонов слушателей', async () => {
    const result = await importSiteOrders(user('ADMIN'), { mode: 'apply' }, ITEMS)
    const surfaces = [JSON.stringify(result), JSON.stringify(audit.writeAudit.mock.calls), JSON.stringify(store.orders)]
    for (const surface of surfaces) for (const secret of PERSONAL) expect(surface).not.toContain(secret)
    expect(audit.writeAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'import.site_orders' }))
  })

  it.each(['ANALYST', 'VIEWER', 'UNIVERSITY_REP'] as const)('%s — 403, до разбора файла', async (role) => {
    expect(() => assertCanImportOrders(user(role))).toThrow()
    await expectRejectCode(importSiteOrders(user(role), { mode: 'preview' }, ITEMS), 'FORBIDDEN')
    await expectRejectCode(buildLmsFile(user(role), { scope: 'all' }, ITEMS), 'FORBIDDEN')
    expect(repo.findCoursesByKeys).not.toHaveBeenCalled()
  })

  it('тело: не JSON, не массив, пустой массив — ошибка проверки', () => {
    expect(() => parseOrdersBody(Buffer.from('{oops'))).toThrow(/не корректный JSON/)
    expect(() => parseOrdersBody(Buffer.from('{"a":1}'))).toThrow(/JSON-массивом/)
    expect(() => parseOrdersBody(Buffer.from('[]'))).toThrow(/нет заказов/)
    expect(parseOrdersBody(Buffer.from('﻿[null]'))).toEqual([null])
  })
})

describe('файл «Загрузка пользователей» для LMS', () => {
  it('до загрузки заказов — понятный отказ: файл LMS — следствие учтённого набора', async () => {
    await expectRejectCode(buildLmsFile(user('MANAGER'), { scope: 'new' }, ITEMS), 'VALIDATION_ERROR')
  })

  it('один человек — одна строка; повтор scope=new — никого; scope=all — снова все', async () => {
    await importSiteOrders(user('MANAGER'), { mode: 'apply' }, ITEMS)
    const file = await buildLmsFile(user('MANAGER'), { scope: 'new' }, ITEMS, new Date('2026-09-25T10:00:00Z'))
    // 6 загруженных заказов, из них 3 у одной слушательницы — 4 человека.
    expect(file.rows).toBe(4)
    expect(file.duplicatesMerged).toBe(2)
    expect(file.fileName).toBe('lms-users-2026-09-25.xlsx')

    const [sheet] = readXlsx(file.file)
    expect(sheet!.rows).toHaveLength(5)
    const people = sheet!.rows.slice(1).map((row) => row.slice(0, 5))
    expect(people).toContainEqual(['Тестова', 'Алла', 'Борисовна', '79000000101', 'testova.ab@example.invalid'])
    expect(people).toContainEqual(['Примеров', 'Пётр', 'Сергеевич', '79000000202', 'primerov.ps@example.invalid'])
    expect(people).toContainEqual(['Образцов', 'Олег', '', '79000000303', 'obrazcov.o@example.invalid'])
    expect(store.orders.every((order) => order.lmsExportedAt !== null)).toBe(true)

    await expectRejectCode(buildLmsFile(user('MANAGER'), { scope: 'new' }, ITEMS), 'VALIDATION_ERROR')
    const again = await buildLmsFile(user('MANAGER'), { scope: 'all' }, ITEMS)
    expect(again.rows).toBe(4)

    // Журнал выгрузки — счётчики, без ПД.
    const exportAudit = audit.writeAudit.mock.calls.find(([entry]) => entry.action === 'export.lms_users')
    expect(exportAudit?.[0].payload).toMatchObject({ rows: 4, scope: 'new' })
    for (const secret of PERSONAL) expect(JSON.stringify(audit.writeAudit.mock.calls)).not.toContain(secret)
  })

  it('фильтр по курсу и потоку: одна группа — один файл', async () => {
    await importSiteOrders(user('MANAGER'), { mode: 'apply' }, ITEMS)
    const file = await buildLmsFile(user('MANAGER'), { scope: 'all', courseId: 'course-5', stream: 4 }, ITEMS)
    expect(file.rows).toBe(1)
    const [sheet] = readXlsx(file.file)
    expect(sheet!.rows[1]!.slice(0, 2)).toEqual(['Тестова', 'Алла'])
  })
})
