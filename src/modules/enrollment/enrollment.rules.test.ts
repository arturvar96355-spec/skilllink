import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ListenerIndex, analyzeOrders, contactHash, countListeners, parseOrderNumber } from './enrollment.rules'

const NOW = new Date('2026-09-25T12:00:00Z')
const FIXTURE = JSON.parse(readFileSync(join(process.cwd(), 'tests/fixtures/site-orders.sample.json'), 'utf8')) as unknown[]
const KEY = 'test-key-test-key-test-key-test-key'

describe('номер заявки', () => {
  it('правильный номер: дата по Москве → UTC', () => {
    const check = parseOrderNumber('ORD-20260904075403-ZXFSZX', NOW)
    expect(check.problem).toBeNull()
    expect(check.orderedAt?.toISOString()).toBe('2026-09-04T04:54:03.000Z')
  })

  it.each([
    ['ORD-20260313051569-OYJRVN', 'секунды 69'],
    ['ORD-20261721184559-AJIJEN', 'месяц 17'],
    ['ORD-202605130654453-GDJIKG', '15 цифр вместо 14'],
    ['ORD-20260230120000-AAAAAA', 'день 30'],
    ['ORD-20260101246000-AAAAAA', 'час 24, минуты 60'],
    ['ЗАКАЗ-123', 'не в формате'],
  ])('битый номер %s — дата не берётся, причина названа (%s)', (orderNo, reason) => {
    const check = parseOrderNumber(orderNo, NOW)
    expect(check.orderedAt).toBeNull()
    expect(check.problem).toContain(reason)
  })

  it('29 февраля високосного года — настоящая дата', () => {
    expect(parseOrderNumber('ORD-20280229100000-AAAAAA', new Date('2028-03-01')).orderedAt).not.toBeNull()
  })

  it('дата в будущем и короткий код — предупреждение, дата остаётся', () => {
    expect(parseOrderNumber('ORD-20270101100000-AAAAAA', NOW).problem).toContain('в будущем')
    const short = parseOrderNumber('ORD-20260101100000-AB', NOW)
    expect(short.orderedAt).not.toBeNull()
    expect(short.problem).toContain('2 знаков')
  })
})

describe('HMAC почты и телефона', () => {
  it('детерминирован, зависит от ключа и вида значения, не содержит значения', () => {
    const a = contactHash(KEY, 'email', 'a@example.invalid')
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(contactHash(KEY, 'email', 'a@example.invalid')).toBe(a)
    expect(contactHash('другой-ключ', 'email', 'a@example.invalid')).not.toBe(a)
    expect(contactHash(KEY, 'phone', 'a@example.invalid')).not.toBe(a)
  })
})

describe('разбор файла заказов (синтетическая фикстура по образцу организаторов)', () => {
  const result = analyzeOrders(FIXTURE, KEY, NOW)

  it('null пропущен, строки с ошибками не приняты, остальные приняты', () => {
    expect(result.quality.totalItems).toBe(10)
    expect(result.quality.emptyItemsSkipped).toBe(1)
    // Элемент 8 — повтор номера, элемент 10 — телефон, почта и поток с ошибками.
    expect(result.orders.map((order) => order.row)).toEqual([2, 3, 4, 5, 6, 7, 9])
  })

  it('ошибки — с номером элемента и колонкой', () => {
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ row: 8, column: 'Номер заявки', message: expect.stringContaining('уже встречался в файле (элемент 6)') }),
        expect.objectContaining({ row: 10, column: 'Телефон' }),
        expect.objectContaining({ row: 10, column: 'Email' }),
        expect.objectContaining({ row: 10, column: 'Номер потока' }),
      ]),
    )
  })

  it('отчёт качества: телефоны, почты, ФИО, битые номера, дубли', () => {
    expect(result.quality).toMatchObject({
      phonesNormalized: 7,
      emailsLowercased: 2,
      namesFixed: 1,
      brokenOrderNumbers: 3,
      duplicateOrderNumbersInFile: 1,
      duplicateListenersInFile: 1,
    })
  })

  it('нормализация: телефон 7XXXXXXXXXX, почта в нижнем регистре, ФИО с заглавной', () => {
    const second = result.orders.find((order) => order.row === 3)!
    expect(second).toMatchObject({ lastName: 'Примеров', firstName: 'Пётр', phoneDigits: '79000000202' })
    const third = result.orders.find((order) => order.row === 4)!
    expect(third).toMatchObject({ middleName: null, phoneDigits: '79000000303', email: 'obrazcov.o@example.invalid', orderedAt: null })
  })

  it('один человек в разном регистре почты — один HMAC', () => {
    const [first, fifth] = [2, 6].map((row) => result.orders.find((order) => order.row === row)!)
    expect(first!.emailHash).toBe(fifth!.emailHash)
  })

  it('в ошибках и предупреждениях нет ни почт, ни телефонов, ни фамилий', () => {
    const text = JSON.stringify([result.errors, result.warnings])
    for (const secret of ['testova', 'example.invalid', '900', 'Тестова', 'Ошибкина', 'не-почта', '12-34']) {
      expect(text).not.toContain(secret)
    }
  })

  it('не массив объектов — ошибка элемента, а не падение', () => {
    const odd = analyzeOrders([42, 'строка', [], {}], KEY, NOW)
    expect(odd.errors.map((issue) => issue.row)).toEqual([1, 2, 3])
    expect(odd.quality.emptyItemsSkipped).toBe(1)
  })
})

describe('слушатели: общая почта или общий телефон — один человек', () => {
  it('цепочка почта→телефон→почта склеивается', () => {
    const index = new ListenerIndex()
    index.add(['e1', 'p1'])
    index.add(['e2', 'p1'])
    index.add(['e3', 'p3'])
    expect(index.personOf(['e1', null])).toBe(index.personOf(['e2', null]))
    expect(index.personOf(['e3', null])).not.toBe(index.personOf(['e1', null]))
  })

  it('countListeners', () => {
    expect(
      countListeners([
        { emailHash: 'e1', phoneHash: 'p1' },
        { emailHash: 'e1', phoneHash: null },
        { emailHash: 'e2', phoneHash: 'p1' },
        { emailHash: 'e9', phoneHash: 'p9' },
      ]),
    ).toBe(2)
    expect(countListeners([])).toBe(0)
  })
})
