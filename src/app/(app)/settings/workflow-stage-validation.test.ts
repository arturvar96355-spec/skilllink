import { describe, expect, it } from 'vitest'
import { validateNormativeDays, validateStageTitle } from './workflow-stage-validation'

describe('название этапа', () => {
  it('пустое или из одних пробелов — ошибка', () => {
    expect(validateStageTitle('')).toEqual({ ok: false, error: 'Укажите название' })
    expect(validateStageTitle('   ')).toEqual({ ok: false, error: 'Укажите название' })
  })

  it('обрезает пробелы по краям', () => {
    expect(validateStageTitle('  Подписание документов  ')).toEqual({
      ok: true,
      value: 'Подписание документов',
    })
  })

  it('длиннее 200 символов — ошибка', () => {
    const long = 'а'.repeat(201)
    const result = validateStageTitle(long)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('200')
  })

  it('ровно 200 символов — ещё годится', () => {
    const exact = 'а'.repeat(200)
    expect(validateStageTitle(exact)).toEqual({ ok: true, value: exact })
  })
})

describe('нормативный срок в днях', () => {
  it('пустая строка — ошибка', () => {
    expect(validateNormativeDays('')).toEqual({ ok: false, error: 'Укажите срок в днях' })
    expect(validateNormativeDays('   ')).toEqual({ ok: false, error: 'Укажите срок в днях' })
  })

  it('не целое число — ошибка', () => {
    for (const bad of ['12.5', 'abc', '-5', '1e3', '5 дней']) {
      expect(validateNormativeDays(bad).ok, bad).toBe(false)
    }
  })

  it('меньше 1 — ошибка', () => {
    expect(validateNormativeDays('0')).toEqual({ ok: false, error: 'Не меньше 1 дня' })
  })

  it('больше 3650 — ошибка', () => {
    expect(validateNormativeDays('3651')).toEqual({ ok: false, error: 'Не больше 3650 дней' })
  })

  it('границы диапазона годятся', () => {
    expect(validateNormativeDays('1')).toEqual({ ok: true, value: 1 })
    expect(validateNormativeDays('3650')).toEqual({ ok: true, value: 3650 })
  })

  it('обычное значение — как в демо-шаблоне', () => {
    expect(validateNormativeDays('63')).toEqual({ ok: true, value: 63 })
  })
})
