import { describe, expect, it } from 'vitest'
import { activeQuickDue, assignmentTone, dueText, nextStatusAction, placeText, quickDueDate, splitByDone } from './assignment-view'
import type { AssignmentDto } from '@/shared/contracts'

/** Поручения на экране (решение 207): быстрые сроки, подписи, тон, одна кнопка статуса. */

describe('быстрые сроки', () => {
  it('в среду: завтра — четверг, до пятницы — эта пятница, через неделю — среда', () => {
    const wednesday = '2026-09-30'
    expect(quickDueDate('tomorrow', wednesday)).toBe('2026-10-01')
    expect(quickDueDate('friday', wednesday)).toBe('2026-10-02')
    expect(quickDueDate('week', wednesday)).toBe('2026-10-07')
  })

  it('в пятницу и в воскресенье «до пятницы» — пятница следующей недели', () => {
    expect(quickDueDate('friday', '2026-10-02')).toBe('2026-10-09')
    expect(quickDueDate('friday', '2026-09-27')).toBe('2026-10-02')
  })

  it('подсвечивается кнопка, чья дата выбрана', () => {
    expect(activeQuickDue('2026-10-02', '2026-09-30')).toBe('friday')
    expect(activeQuickDue('2026-10-05', '2026-09-30')).toBeNull()
  })
})

describe('строка поручения', () => {
  const base = { dueDate: '2026-10-02', daysOverdue: null, doneAt: null }

  it('подпись срока', () => {
    expect(dueText({ ...base, dueState: 'overdue', daysOverdue: 2 })).toBe('просрочено на 2 дня')
    expect(dueText({ ...base, dueState: 'today' })).toBe('срок сегодня')
    expect(dueText({ ...base, dueState: 'tomorrow' })).toBe('срок завтра')
    expect(dueText({ ...base, dueState: 'later' })).toBe('до 2 октября')
  })

  it('красная полоска — только у просрочки, важное насыщеннее обычного', () => {
    expect(assignmentTone({ dueState: 'overdue', priority: 'NORMAL' })).toBe('critical')
    expect(assignmentTone({ dueState: 'later', priority: 'HIGH' })).toBe('accent')
    expect(assignmentTone({ dueState: 'later', priority: 'NORMAL' })).toBe('accent-soft')
    expect(assignmentTone({ dueState: 'done', priority: 'HIGH' })).toBe('accent-faint')
  })

  it('одна кнопка двигает статус по кругу', () => {
    expect(nextStatusAction('NEW')).toEqual({ to: 'IN_PROGRESS', label: 'Взять в работу' })
    expect(nextStatusAction('IN_PROGRESS')).toEqual({ to: 'DONE', label: 'Сделано' })
    expect(nextStatusAction('DONE')).toEqual({ to: 'IN_PROGRESS', label: 'Вернуть в работу' })
  })

  it('место: вуз и программа связки, только вуз или ничего', () => {
    const university = { id: 'u', name: 'Московский технический университет связи и информатики', shortName: 'МТУСИ' }
    expect(placeText({ university, cooperation: { id: 'c', programName: 'Анализ данных' } })).toBe('МТУСИ → Анализ данных')
    expect(placeText({ university, cooperation: null })).toBe('МТУСИ')
    expect(placeText({ university: null, cooperation: null })).toBeNull()
  })

  it('сделанные — свежие сверху', () => {
    const item = (id: string, status: AssignmentDto['status'], doneAt: string | null) => ({ id, status, doneAt }) as AssignmentDto
    const { open, done } = splitByDone([item('a', 'DONE', '2026-09-20T10:00:00Z'), item('b', 'NEW', null), item('c', 'DONE', '2026-09-26T10:00:00Z')])
    expect(open.map((row) => row.id)).toEqual(['b'])
    expect(done.map((row) => row.id)).toEqual(['c', 'a'])
  })
})
