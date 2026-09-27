import { describe, expect, it } from 'vitest'
import { priorityActionsEmptyState } from './priority-actions-empty'

/**
 * Пустое состояние блока «Приоритетные действия» (исправление 187, находка
 * ночного ревью 27.09): решение 180 убрало `stage.overdue` из приоритетных
 * действий, но пустой список из-за этого начал звучать как «рекомендаций
 * нет вообще» даже когда открытые просрочки этапов есть.
 */
describe('priorityActionsEmptyState', () => {
  it('открытых рекомендаций нет вообще — обычные заголовок и текст', () => {
    expect(priorityActionsEmptyState(0)).toEqual({
      title: 'Рекомендаций нет',
      description: 'Система ещё не собирала предложения или все они закрыты.',
    })
  })

  it('открыты только просрочки этапов (исключены из списка решением 180) — заголовок и текст указывают, где искать', () => {
    // До исправления: список пуст → «Рекомендаций нет… всё закрыто», хотя
    // открытые рекомендации есть — их просто показали в блоке
    // «Требует внимания» вместо этого.
    const state = priorityActionsEmptyState(3)
    expect(state.title).not.toBe('Рекомендаций нет')
    expect(state.description).not.toMatch(/закрыт/)
    expect(state.description).toContain('Требует внимания')
    expect(state.description).toContain('«Списке задач»')
  })

  it('не говорит «выше»: на широком экране соседний блок слева, а не над этим (решение 206)', () => {
    expect(priorityActionsEmptyState(3).description).not.toMatch(/выше/)
  })
})
