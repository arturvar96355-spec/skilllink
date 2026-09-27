import { describe, expect, it } from 'vitest'
import { buildFeed, type AssignmentFeedSource, type FeedSources } from '@/modules/notifications/notifications.rules'
import {
  canChangeAssignmentStatus,
  canEditAssignment,
  daysOverdue,
  dueState,
  isAssignmentOverdue,
  isCalendarDate,
  isDueDateInPast,
  nextDoneAt,
  shouldNotifyAssignee,
  todayIso,
} from './assignments.rules'
import { buildAssignmentMessage, formatDueDay } from './assignments.notice'
import { createAssignmentSchema, updateAssignmentSchema } from './assignments.schema'

/** Правила поручений (решение 207): срок, просрочка, права по полям, уведомление. */

// Воскресенье 27.09.2026, 23:30 по Москве (20:30 UTC).
const NOW = new Date('2026-09-27T20:30:00.000Z')

describe('сегодня — по московской дате', () => {
  it('поздний вечер по Москве — та же дата', () => {
    expect(todayIso(NOW)).toBe('2026-09-27')
  })

  it('после полуночи по Москве — уже следующий день, хотя по UTC ещё вчера', () => {
    expect(todayIso(new Date('2026-09-27T21:30:00.000Z'))).toBe('2026-09-28')
  })
})

describe('просрочка', () => {
  const today = '2026-09-27'

  it('день срока — ещё не просрочка', () => {
    expect(isAssignmentOverdue('2026-09-27', 'IN_PROGRESS', today)).toBe(false)
    expect(dueState('2026-09-27', 'IN_PROGRESS', today)).toBe('today')
  })

  it('на следующий день после срока — просрочено, считаем дни', () => {
    expect(isAssignmentOverdue('2026-09-25', 'NEW', today)).toBe(true)
    expect(dueState('2026-09-25', 'NEW', today)).toBe('overdue')
    expect(daysOverdue('2026-09-25', 'NEW', today)).toBe(2)
  })

  it('сделанное поручение не просрочено, даже если срок давно прошёл', () => {
    expect(isAssignmentOverdue('2026-09-01', 'DONE', today)).toBe(false)
    expect(dueState('2026-09-01', 'DONE', today)).toBe('done')
    expect(daysOverdue('2026-09-01', 'DONE', today)).toBeNull()
  })

  it('завтра и позже', () => {
    expect(dueState('2026-09-28', 'NEW', today)).toBe('tomorrow')
    expect(dueState('2026-10-02', 'NEW', today)).toBe('later')
  })

  it('срок через границу месяца считается по календарю', () => {
    expect(daysOverdue('2026-08-31', 'IN_PROGRESS', '2026-09-01')).toBe(1)
  })
})

describe('срок при создании', () => {
  it('вчера — в прошлом, сегодня — можно', () => {
    expect(isDueDateInPast('2026-09-26', '2026-09-27')).toBe(true)
    expect(isDueDateInPast('2026-09-27', '2026-09-27')).toBe(false)
  })

  it('дата проверяется по календарю: 30 февраля нет', () => {
    expect(isCalendarDate('2026-10-02')).toBe(true)
    expect(isCalendarDate('2026-02-30')).toBe(false)
    expect(isCalendarDate('02.10.2026')).toBe(false)
    expect(isCalendarDate('2026-10-02T00:00:00Z')).toBe(false)
  })
})

describe('проверка ввода', () => {
  const valid = { assigneeId: 'u1', text: 'Позвонить в МТУСИ', dueDate: '2026-10-02' }

  it('пустой текст и текст из пробелов — отказ с понятной причиной', () => {
    for (const text of ['', '   ']) {
      const result = createAssignmentSchema.safeParse({ ...valid, text })
      expect(result.success).toBe(false)
      expect(result.error?.issues[0]).toMatchObject({ path: ['text'], message: 'Опишите, что сделать' })
    }
  })

  it('текст длиннее 300 символов — отказ; края обрезаются', () => {
    expect(createAssignmentSchema.safeParse({ ...valid, text: 'а'.repeat(301) }).success).toBe(false)
    expect(createAssignmentSchema.parse({ ...valid, text: '  Позвонить  ' }).text).toBe('Позвонить')
  })

  it('без срока — отказ; важность по умолчанию обычная', () => {
    const { dueDate: _omitted, ...withoutDue } = valid
    expect(createAssignmentSchema.safeParse(withoutDue).success).toBe(false)
    expect(createAssignmentSchema.parse(valid).priority).toBe('NORMAL')
  })

  it('пустая правка — отказ', () => {
    expect(updateAssignmentSchema.safeParse({}).success).toBe(false)
    expect(updateAssignmentSchema.safeParse({ status: 'DONE' }).success).toBe(true)
  })
})

describe('кто что меняет', () => {
  const row = { assigneeId: 'manager', authorId: 'head' }

  it('автор — всё и статус; исполнитель — только статус; посторонний — ничего', () => {
    expect(canEditAssignment({ id: 'head' }, row)).toBe(true)
    expect(canChangeAssignmentStatus({ id: 'head' }, row)).toBe(true)
    expect(canEditAssignment({ id: 'manager' }, row)).toBe(false)
    expect(canChangeAssignmentStatus({ id: 'manager' }, row)).toBe(true)
    expect(canEditAssignment({ id: 'other' }, row)).toBe(false)
    expect(canChangeAssignmentStatus({ id: 'other' }, row)).toBe(false)
  })

  it('эксперт хакатона ничего не меняет, даже будучи автором или исполнителем', () => {
    expect(canEditAssignment({ id: 'head', isReviewer: true }, row)).toBe(false)
    expect(canChangeAssignmentStatus({ id: 'manager', isReviewer: true }, row)).toBe(false)
  })

  it('дата выполнения ставится при «Сделано», сохраняется при повторе и снимается при возврате', () => {
    const now = new Date('2026-09-27T10:00:00.000Z')
    const earlier = new Date('2026-09-26T10:00:00.000Z')
    expect(nextDoneAt({ status: 'IN_PROGRESS', doneAt: null }, 'DONE', now)).toEqual(now)
    expect(nextDoneAt({ status: 'DONE', doneAt: earlier }, 'DONE', now)).toEqual(earlier)
    expect(nextDoneAt({ status: 'DONE', doneAt: earlier }, 'IN_PROGRESS', now)).toBeNull()
  })
})

describe('уведомление исполнителю', () => {
  it('новому исполнителю — да; себе и прежнему — нет', () => {
    expect(shouldNotifyAssignee({ assigneeId: 'manager', previousAssigneeId: null, actorId: 'head' })).toBe(true)
    expect(shouldNotifyAssignee({ assigneeId: 'head', previousAssigneeId: null, actorId: 'head' })).toBe(false)
    expect(shouldNotifyAssignee({ assigneeId: 'manager', previousAssigneeId: 'manager', actorId: 'head' })).toBe(false)
    expect(shouldNotifyAssignee({ assigneeId: 'analyst', previousAssigneeId: 'manager', actorId: 'head' })).toBe(true)
  })

  it('в мессенджер — только вуз, срок и важность, без текста поручения; кнопка «Открыть поручение»', () => {
    const message = buildAssignmentMessage(
      { assignmentId: 'a1', dueDate: '2026-10-02', priority: 'HIGH', universityName: 'МТУСИ' },
      { baseUrl: 'https://skilllink.example/' },
    )
    expect(message.text).toContain('важное')
    expect(message.text).toContain('Вуз: МТУСИ.')
    expect(message.text).toContain('Срок: 02.10, пятница.')
    expect(message.actions).toEqual([
      [{ kind: 'open', text: 'Открыть поручение', url: 'https://skilllink.example/profile?assignment=a1#my-assignments' }],
    ])
  })

  it('без адреса стенда — без кнопок, а не ссылка на localhost', () => {
    const message = buildAssignmentMessage(
      { assignmentId: 'a1', dueDate: '2026-10-05', priority: 'NORMAL', universityName: null },
      { baseUrl: null },
    )
    expect(message.actions).toEqual([])
    expect(message.text).not.toContain('Вуз:')
    expect(formatDueDay('2026-10-05')).toBe('05.10, понедельник')
  })
})

describe('колокольчик: «Вам поручение», «срок завтра», «срок прошёл»', () => {
  const empty: FeedSources = {
    deadlines: [],
    stageChanges: [],
    documentChanges: [],
    recommendations: [],
    responsibleAssignments: [],
    assignments: [],
  }
  const source = (partial: Partial<AssignmentFeedSource>): AssignmentFeedSource => ({
    id: 'a1',
    text: 'Позвонить в МТУСИ и подтвердить состав кафедры',
    status: 'NEW',
    priority: 'NORMAL',
    dueDate: '2026-10-02',
    universityName: 'МТУСИ',
    cooperationId: null,
    fromSomeoneElse: true,
    createdAt: new Date('2026-09-27T08:00:00.000Z'),
    ...partial,
  })
  const feed = (assignments: AssignmentFeedSource[]) =>
    buildFeed({ ...empty, assignments }, { now: NOW, since: null, limit: 20 }).items

  it('новое поручение от руководителя ведёт в «Мои поручения»', () => {
    const [item] = feed([source({ priority: 'HIGH' })])
    expect(item).toMatchObject({
      kind: 'assignment.new',
      severity: 'warning',
      title: 'Вам поручение (важное): «Позвонить в МТУСИ и подтвердить состав кафедры»',
      description: 'МТУСИ · срок 02.10.2026',
      target: { type: 'assignment', id: 'a1' },
    })
  })

  it('своё собственное поручение «новым» не считается', () => {
    expect(feed([source({ fromSomeoneElse: false })])).toEqual([])
  })

  it('срок завтра — предупреждение; срок прошёл — критично', () => {
    const kinds = feed([
      source({ id: 'tomorrow', dueDate: '2026-09-28', fromSomeoneElse: false }),
      source({ id: 'late', dueDate: '2026-09-25', fromSomeoneElse: false, status: 'IN_PROGRESS' }),
      source({ id: 'today', dueDate: '2026-09-27', fromSomeoneElse: false }),
    ]).map((item) => [item.id, item.kind, item.severity])
    expect(kinds).toContainEqual(['assignment-due-soon:tomorrow', 'assignment.due-soon', 'warning'])
    expect(kinds).toContainEqual(['assignment-overdue:late', 'assignment.overdue', 'critical'])
    // День срока — ни «завтра», ни «прошёл».
    expect(kinds.some(([id]) => String(id).endsWith(':today'))).toBe(false)
  })

  it('время просрочки — начало дня после срока по Москве, а не момент запроса', () => {
    const [item] = feed([source({ dueDate: '2026-09-25', fromSomeoneElse: false })])
    expect(item!.occurredAt).toBe('2026-09-25T21:00:00.000Z')
  })
})
