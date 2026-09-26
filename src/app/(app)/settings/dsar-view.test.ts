import { describe, expect, it } from 'vitest'
import type { DsarRequestDto } from '@/shared/contracts'
import { dsarChannelCaption, dsarConfirmHint, dsarDueCaption, dsarRequestTitle } from './dsar-view'

/** Реестр запросов субъектов ПД («Настройки → Запросы субъектов», решение 181). */

function request(overrides: Partial<DsarRequestDto> = {}): DsarRequestDto {
  return {
    id: 'req-1',
    subjectType: 'USER',
    subjectId: 'user-1',
    kind: 'EXPORT',
    channel: 'LETTER',
    status: 'OPEN',
    requestedBy: { id: 'admin-1', fullName: 'Иванова Мария Сергеевна', role: 'ADMIN' },
    requestedAt: '2026-09-20T10:00:00.000Z',
    dueAt: '2026-10-05T20:59:59.999Z',
    completedAt: null,
    overdue: false,
    summary: null,
    ...overrides,
  }
}

describe('dsarRequestTitle', () => {
  it('вид и тип субъекта', () => {
    expect(dsarRequestTitle(request())).toBe('Сведения о ПД (ст. 14) · Пользователь системы')
    expect(dsarRequestTitle(request({ kind: 'ERASE', subjectType: 'CONTACT' }))).toBe(
      'Уничтожение ПД (ст. 20, 21) · Контактное лицо вуза',
    )
  })
})

describe('dsarDueCaption', () => {
  it('открытый в срок — «срок до»', () => {
    expect(dsarDueCaption(request({ status: 'OPEN', overdue: false, dueAt: '2026-10-05T20:59:59.999Z' }))).toBe(
      'Срок до 05.10.2026',
    )
  })

  it('открытый просроченный — предупреждение', () => {
    expect(dsarDueCaption(request({ status: 'OPEN', overdue: true, dueAt: '2026-09-01T20:59:59.999Z' }))).toBe(
      'Просрочен — срок был 01.09.2026',
    )
  })

  it('исполненный — дата исполнения, не срок', () => {
    expect(
      dsarDueCaption(request({ status: 'COMPLETED', completedAt: '2026-09-22T09:00:00.000Z', overdue: false })),
    ).toBe('Исполнен 22.09.2026')
  })
})

describe('dsarChannelCaption', () => {
  it('канал — словами', () => {
    expect(dsarChannelCaption(request({ channel: 'SELF_SERVICE' }))).toBe('Сам в личном кабинете')
    expect(dsarChannelCaption(request({ channel: 'ADMIN' }))).toBe('Администратор без письма')
  })
})

describe('dsarConfirmHint', () => {
  it('для пользователя просит логин, для контакта — ФИО', () => {
    expect(dsarConfirmHint('USER')).toContain('почту')
    expect(dsarConfirmHint('CONTACT')).toContain('ФИО')
  })
})
