import { describe, expect, it } from 'vitest'
import { hasActiveFilters } from './reset-filters'

describe('hasActiveFilters', () => {
  it('не находит фильтр, когда все поля пустые', () => {
    expect(hasActiveFilters({ search: '', status: '' })).toBe(false)
  })

  it('находит фильтр, если хоть одно поле не пустое', () => {
    expect(hasActiveFilters({ search: 'вуз', status: '' })).toBe(true)
    expect(hasActiveFilters({ search: '', status: 'ARCHIVED' })).toBe(true)
  })

  it('сравнивает со своим значением по умолчанию, а не всегда с пустой строкой', () => {
    // «Журнал действий»: до 45 000 ₽ статус по умолчанию — «Открыт» (решение 128,
    // «Рекомендации»), а не пустая строка.
    expect(hasActiveFilters({ status: 'open' }, { status: 'open' })).toBe(false)
    expect(hasActiveFilters({ status: 'closed' }, { status: 'open' })).toBe(true)
  })

  it('работает с чекбоксами: по умолчанию false, а не пустая строка', () => {
    expect(hasActiveFilters({ criticalOnly: false })).toBe(false)
    expect(hasActiveFilters({ criticalOnly: true })).toBe(true)
  })

  it('не путает отложенный и введённый поиск: значение берётся как есть', () => {
    // Хук сам не обращается к useDebounced — вызывающий код обязан передать
    // введённое значение, а не отложенное, иначе кнопка появлялась бы с задержкой.
    expect(hasActiveFilters({ search: '  '.trim() })).toBe(false)
    expect(hasActiveFilters({ search: ' а'.trim() })).toBe(true)
  })
})
