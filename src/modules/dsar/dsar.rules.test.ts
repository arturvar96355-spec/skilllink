import { describe, expect, it } from 'vitest'
import {
  addWorkingDays,
  confirmMatches,
  dueDate,
  erasedUserEmail,
  findSecretKeys,
  holidaysOf,
  isErasedUser,
  isWorkingDay,
  selfExportRetryAfter,
  withoutClientAddress,
  ERASED_USER_NAME,
} from './dsar.rules'

/** Конец московских суток даты `ГГГГ-ММ-ДД` — так хранится срок ответа. */
const endOfMoscowDay = (isoDate: string) => new Date(`${isoDate}T23:59:59.999+03:00`)

describe('рабочие дни (производственный календарь РФ)', () => {
  it('суббота и воскресенье — выходные', () => {
    expect(isWorkingDay('2026-09-26')).toBe(false)
    expect(isWorkingDay('2026-09-27')).toBe(false)
    expect(isWorkingDay('2026-09-28')).toBe(true)
  })

  it('праздники 2026: январские, перенос 9 января и 31 декабря (постановление № 1466)', () => {
    for (const day of ['2026-01-01', '2026-01-08', '2026-01-09', '2026-02-23', '2026-05-01', '2026-06-12', '2026-11-04', '2026-12-31']) {
      expect(isWorkingDay(day), day).toBe(false)
    }
    expect(isWorkingDay('2026-01-12')).toBe(true)
    expect(isWorkingDay('2026-12-30')).toBe(true)
  })

  it('праздник на выходном переносится на следующий рабочий день: 8 марта → 9 марта, 9 мая → 11 мая', () => {
    expect(isWorkingDay('2026-03-09')).toBe(false)
    expect(isWorkingDay('2026-05-11')).toBe(false)
    expect(isWorkingDay('2026-03-10')).toBe(true)
  })

  it('январские праздники на выходном сами не переносятся (ч. 2 ст. 112 ТК РФ)', () => {
    // 2027: 2 и 3 января — суббота и воскресенье; без постановления на 2027 переноса нет.
    expect(holidaysOf(2027).has('2027-01-11')).toBe(false)
    expect(isWorkingDay('2027-01-11')).toBe(true)
  })
})

describe('срок ответа на запрос субъекта', () => {
  it('10 рабочих дней на сведения: отсчёт со следующего дня, конец дня по Москве', () => {
    // Пятница 25.09.2026 → 28.09 … 09.10 (две рабочие недели).
    expect(dueDate('EXPORT', new Date('2026-09-25T12:00:00+03:00'))).toEqual(endOfMoscowDay('2026-10-09'))
  })

  it('запрос в выходной: срок идёт с понедельника', () => {
    expect(dueDate('EXPORT', new Date('2026-09-26T12:00:00+03:00'))).toEqual(endOfMoscowDay('2026-10-09'))
  })

  it('поздний вечер по Москве — это уже тот же московский день, а не завтрашний UTC', () => {
    // 22:30 UTC четверга = 01:30 МСК пятницы: отсчёт с понедельника.
    expect(dueDate('EXPORT', new Date('2026-09-24T22:30:00Z'))).toEqual(endOfMoscowDay('2026-10-09'))
  })

  it('майские праздники пропускаются', () => {
    // 30.04: 1.05 выходной, 4–8.05 — 5 дней, 11.05 выходной (перенос 9 мая), 12–15.05 — 9, 18.05 — 10.
    expect(dueDate('EXPORT', new Date('2026-04-30T10:00:00+03:00'))).toEqual(endOfMoscowDay('2026-05-18'))
  })

  it('новогодние праздники: 31.12.2026 и 1–8.01.2027 пропускаются', () => {
    // 25.12 (пт): 28, 29, 30.12 — 3 дня; 31.12 и 1–10.01 выходные; 11–15.01 — 8; 18, 19.01 — 10.
    expect(dueDate('EXPORT', new Date('2026-12-25T10:00:00+03:00'))).toEqual(endOfMoscowDay('2027-01-19'))
  })

  it('7 рабочих дней на уничтожение (ч. 3 ст. 20)', () => {
    expect(dueDate('ERASE', new Date('2026-09-25T12:00:00+03:00'))).toEqual(endOfMoscowDay('2026-10-06'))
  })

  it('ноль и дробные дни — ошибка настройки, а не «срок сегодня»', () => {
    expect(() => addWorkingDays(new Date(), 0)).toThrow()
    expect(() => addWorkingDays(new Date(), 1.5)).toThrow()
  })
})

describe('обезличенный пользователь', () => {
  it('почта-заглушка своя у каждого и никуда не доставляется', () => {
    expect(erasedUserEmail('u1')).toBe('erased-u1@erased.invalid')
    expect(erasedUserEmail('u1')).not.toBe(erasedUserEmail('u2'))
  })

  it('узнаётся по ФИО-заглушке и своей почте-заглушке', () => {
    expect(isErasedUser({ id: 'u1', email: erasedUserEmail('u1'), fullName: ERASED_USER_NAME })).toBe(true)
    expect(isErasedUser({ id: 'u1', email: erasedUserEmail('u2'), fullName: ERASED_USER_NAME })).toBe(false)
    expect(isErasedUser({ id: 'u1', email: 'a@b.ru', fullName: 'Иван' })).toBe(false)
  })
})

describe('подтверждение необратимого действия', () => {
  it('без учёта регистра и лишних пробелов', () => {
    expect(confirmMatches('  Ivan@Example.Invalid ', 'ivan@example.invalid')).toBe(true)
    expect(confirmMatches('ветрова  ирина павловна', 'Ветрова Ирина Павловна')).toBe(true)
  })

  it('чужое, пустое и отсутствующее — не подтверждение', () => {
    expect(confirmMatches('other@example.invalid', 'ivan@example.invalid')).toBe(false)
    expect(confirmMatches('   ', '')).toBe(false)
    expect(confirmMatches('x', null)).toBe(false)
  })
})

describe('чистка выгрузки', () => {
  it('находит ключи-секреты на любой глубине', () => {
    const found = findSecretKeys({
      a: { passwordHash: 'x' },
      list: [{ ok: 1 }, { accessToken: 'y' }],
      tokenHash: 'z',
      clientSecret: 'w',
    })
    expect(found.sort()).toEqual(['.a.passwordHash', '.clientSecret', '.list[1].accessToken', '.tokenHash'])
    expect(findSecretKeys({ createdAt: new Date(), items: [] })).toEqual([])
  })

  it('из записи журнала о действии над субъектом вырезается адрес действовавшего', () => {
    expect(withoutClientAddress({ address: '10.0.0.1', dataset: 'users' })).toEqual({ dataset: 'users' })
    expect(withoutClientAddress(null)).toBeNull()
    expect(withoutClientAddress({ fields: ['fullName'] })).toEqual({ fields: ['fullName'] })
  })
})

describe('частота самостоятельной выгрузки', () => {
  const now = new Date('2026-09-25T12:00:00Z')

  it('первая — сразу', () => {
    expect(selfExportRetryAfter(null, now, 10)).toBe(0)
  })

  it('повтор раньше интервала — ждать остаток в секундах', () => {
    expect(selfExportRetryAfter(new Date('2026-09-25T11:55:00Z'), now, 10)).toBe(300)
  })

  it('после интервала — можно', () => {
    expect(selfExportRetryAfter(new Date('2026-09-25T11:50:00Z'), now, 10)).toBe(0)
  })
})
