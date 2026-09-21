import { describe, expect, it } from 'vitest'
import { AppError } from '@/shared/http/errors'
import { assertHasLink, assertNextActionHasDate } from './meetings.rules'
import {
  createMeetingSchema,
  meetingParticipantSchema,
  updateMeetingSchema,
} from './meetings.schema'

function expectError(fn: () => void, code: string): void {
  try {
    fn()
  } catch (error) {
    expect(error).toBeInstanceOf(AppError)
    expect((error as AppError).code).toBe(code)
    return
  }
  throw new Error(`Ожидалась ошибка ${code}, но её не было`)
}

describe('привязка встречи', () => {
  it('без привязки встреча не создаётся', () => {
    expectError(() => assertHasLink({}), 'VALIDATION_ERROR')
  })

  it('любой одной привязки достаточно', () => {
    expect(() => assertHasLink({ cooperationId: 'coop-1' })).not.toThrow()
    expect(() => assertHasLink({ universityId: 'uni-1' })).not.toThrow()
  })
})

describe('следующее действие', () => {
  it('действие без срока не принимается', () => {
    expectError(
      () => assertNextActionHasDate('Отправить договор', null),
      'VALIDATION_ERROR',
    )
  })

  it('действие со сроком принимается', () => {
    expect(() =>
      assertNextActionHasDate('Отправить договор', '2026-10-01T00:00:00.000Z'),
    ).not.toThrow()
  })

  it('без действия срок не требуется', () => {
    expect(() => assertNextActionHasDate(null, null)).not.toThrow()
    expect(() => assertNextActionHasDate('   ', null)).not.toThrow()
  })
})

describe('участник встречи', () => {
  it('сотрудник', () => {
    expect(meetingParticipantSchema.safeParse({ userId: 'user-1' }).success).toBe(true)
  })

  it('контактное лицо вуза', () => {
    expect(meetingParticipantSchema.safeParse({ contactId: 'contact-1' }).success).toBe(true)
  })

  it('внешний участник по имени', () => {
    expect(meetingParticipantSchema.safeParse({ externalName: 'Иванов И.И.' }).success).toBe(true)
  })

  it('пустой участник не принимается', () => {
    expect(meetingParticipantSchema.safeParse({}).success).toBe(false)
  })

  it('две роли сразу не принимаются: непонятно, кто участвовал', () => {
    expect(
      meetingParticipantSchema.safeParse({ userId: 'user-1', contactId: 'contact-1' }).success,
    ).toBe(false)
  })
})

describe('валидация встречи', () => {
  const valid = {
    cooperationId: 'coop-1',
    date: '2026-09-20T10:00:00.000Z',
    topic: 'Обсуждение программы обучения',
    responsibleId: 'user-1',
  }

  it('формат по умолчанию — онлайн', () => {
    const parsed = createMeetingSchema.safeParse(valid)
    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data.format).toBe('ONLINE')
  })

  it('отклоняет дату не в формате ISO 8601', () => {
    expect(createMeetingSchema.safeParse({ ...valid, date: '20.09.2026' }).success).toBe(false)
  })

  it('требует ответственного', () => {
    const { responsibleId: _omitted, ...withoutResponsible } = valid
    expect(createMeetingSchema.safeParse(withoutResponsible).success).toBe(false)
  })

  it('отклоняет слишком короткую тему', () => {
    expect(createMeetingSchema.safeParse({ ...valid, topic: 'Ок' }).success).toBe(false)
  })

  it('принимает список участников', () => {
    const parsed = createMeetingSchema.safeParse({
      ...valid,
      participants: [{ userId: 'user-1' }, { externalName: 'Петров П.П.' }],
    })
    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data.participants?.length).toBe(2)
  })

  it('отклоняет некорректного участника в списке', () => {
    expect(
      createMeetingSchema.safeParse({ ...valid, participants: [{}] }).success,
    ).toBe(false)
  })

  it('не принимает пустое тело изменения', () => {
    expect(updateMeetingSchema.safeParse({}).success).toBe(false)
  })

  it('при изменении не подставляет формат по умолчанию', () => {
    const parsed = updateMeetingSchema.safeParse({ topic: 'Новая тема встречи' })
    expect(parsed.success && 'format' in parsed.data).toBe(false)
  })
})
