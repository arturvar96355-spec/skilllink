import { describe, expect, it } from 'vitest'

import { DEADLINE_WARNING_DAYS } from '@/shared/config/analytics.config'
import {
  buildFeed,
  type FeedSources,
  type RecommendationSource,
  type StageDeadlineSource,
} from './notifications.rules'

const DAY = 24 * 60 * 60 * 1000
const now = new Date('2026-09-22T12:00:00Z')

function stage(overrides: Partial<StageDeadlineSource>): StageDeadlineSource {
  return {
    stageId: 'stage-1',
    stageNumber: 6,
    stageTitle: 'Подписание документов',
    status: 'IN_PROGRESS',
    deadline: new Date(now.getTime() - 2 * DAY),
    cooperationId: 'coop-1',
    universityName: 'СПбГУТ',
    programName: 'Программная инженерия',
    lockedByControlPoint: false,
    ...overrides,
  }
}

function recommendation(overrides: Partial<RecommendationSource>): RecommendationSource {
  return {
    id: 'r1',
    ruleKey: 'stage.overdue',
    stageNumber: 6,
    title: 'Просрочен этап 6: Подписание документов',
    label: 'СПбГУТ — Программная инженерия',
    priority: 'CRITICAL',
    createdAt: now,
    cooperationId: 'coop-1',
    ...overrides,
  }
}

function sources(overrides: Partial<FeedSources> = {}): FeedSources {
  return {
    deadlines: [],
    stageChanges: [],
    documentChanges: [],
    recommendations: [],
    responsibleAssignments: [],
    ...overrides,
  }
}

describe('лента уведомлений', () => {
  it('просроченный этап — критично, время события — истёкший срок', () => {
    const deadline = new Date(now.getTime() - 2 * DAY)
    const feed = buildFeed(sources({ deadlines: [stage({ deadline })] }), { now, since: null, limit: 20 })
    expect(feed.items).toHaveLength(1)
    expect(feed.items[0]).toMatchObject({
      kind: 'stage.overdue',
      severity: 'critical',
      occurredAt: deadline.toISOString(),
      target: { type: 'cooperation', id: 'coop-1', cooperationId: 'coop-1', stageId: 'stage-1' },
    })
  })

  it('«скоро срок» и просрочка друг друга исключают', () => {
    const soon = stage({ stageId: 's-soon', deadline: new Date(now.getTime() + DAY) })
    const overdue = stage({ stageId: 's-over', deadline: new Date(now.getTime() - DAY) })
    const far = stage({ stageId: 's-far', deadline: new Date(now.getTime() + 30 * DAY) })
    const feed = buildFeed(sources({ deadlines: [soon, overdue, far] }), { now, since: null, limit: 20 })
    const kinds = Object.fromEntries(feed.items.map((item) => [item.target.stageId, item.kind]))
    expect(kinds).toEqual({ 's-soon': 'stage.due-soon', 's-over': 'stage.overdue' })
  })

  it('«скоро срок» датирован входом в окно предупреждения, а не моментом запроса', () => {
    // Иначе «отметить всё прочитанным» не работало бы: при каждом запросе
    // предупреждение выглядело бы новым.
    const deadline = new Date(now.getTime() + DAY)
    const feed = buildFeed(sources({ deadlines: [stage({ deadline })] }), { now, since: null, limit: 20 })
    expect(feed.items[0]?.occurredAt).toBe(
      new Date(deadline.getTime() - DEADLINE_WARNING_DAYS * DAY).toISOString(),
    )
  })

  it('закрытый этап не напоминает о сроке', () => {
    const done = stage({ status: 'COMPLETED' })
    const cancelled = stage({ stageId: 's-2', status: 'CANCELLED' })
    expect(buildFeed(sources({ deadlines: [done, cancelled] }), { now, since: null, limit: 20 }).items).toEqual([])
  })

  it('прочитанное — то, что не новее отметки последнего просмотра', () => {
    const old = stage({ stageId: 'old', deadline: new Date(now.getTime() - 5 * DAY) })
    const fresh = stage({ stageId: 'fresh', deadline: new Date(now.getTime() - 1 * DAY) })
    const since = new Date(now.getTime() - 3 * DAY)
    const feed = buildFeed(sources({ deadlines: [old, fresh] }), { now, since, limit: 20 })
    expect(feed.unreadCount).toBe(1)
    expect(feed.items.find((item) => item.target.stageId === 'fresh')?.isUnread).toBe(true)
    expect(feed.items.find((item) => item.target.stageId === 'old')?.isUnread).toBe(false)
  })

  it('без отметки непрочитанным считается всё', () => {
    const feed = buildFeed(sources({ deadlines: [stage({})] }), { now, since: null, limit: 20 })
    expect(feed.unreadCount).toBe(1)
  })

  it('счётчик непрочитанного — по всей ленте, а не по показанной части', () => {
    const many = Array.from({ length: 7 }, (_, index) =>
      stage({ stageId: `s-${index}`, deadline: new Date(now.getTime() - (index + 1) * DAY) }),
    )
    const feed = buildFeed(sources({ deadlines: many }), { now, since: null, limit: 3 })
    expect(feed.items).toHaveLength(3)
    expect(feed.unreadCount).toBe(7)
  })

  it('свежие изменения не вытесняют просрочку из показанной части', () => {
    // Просрочка датирована истёкшим сроком — прошлым. При обрезке по времени
    // двадцать свежих изменений вытолкнули бы её из колокольчика целиком.
    const overdue = [
      stage({ stageId: 'old-1', deadline: new Date(now.getTime() - 40 * DAY) }),
      stage({ stageId: 'old-2', deadline: new Date(now.getTime() - 50 * DAY) }),
    ]
    const changes = Array.from({ length: 30 }, (_, index) => ({
      historyId: `h-${index}`,
      stageId: `changed-${index}`,
      stageNumber: 3,
      stageTitle: 'Организация встречи',
      toStatus: 'IN_PROGRESS' as const,
      changedAt: new Date(now.getTime() - (index + 1) * 60 * 60 * 1000),
      cooperationId: 'coop-2',
      universityName: 'МТУСИ',
      programName: 'Анализ данных',
      authorName: 'Коллега',
    }))
    const feed = buildFeed(sources({ deadlines: overdue, stageChanges: changes }), {
      now,
      since: null,
      limit: 20,
    })

    expect(feed.items).toHaveLength(20)
    expect(feed.items.filter((item) => item.kind === 'stage.overdue')).toHaveLength(2)
    // Порядок — по времени: просрочки внизу, потому что они старше.
    expect(feed.items.slice(-2).map((item) => item.target.stageId)).toEqual(['old-1', 'old-2'])
    const times = feed.items.map((item) => item.occurredAt)
    expect([...times].sort().reverse()).toEqual(times)
  })

  it('новые сверху, при равном времени порядок постоянный', () => {
    const at = new Date(now.getTime() - DAY)
    const feed = buildFeed(
      sources({
        deadlines: [
          stage({ stageId: 'b', deadline: at }),
          stage({ stageId: 'a', deadline: at }),
          stage({ stageId: 'c', deadline: new Date(now.getTime() - 3 * DAY) }),
        ],
      }),
      { now, since: null, limit: 20 },
    )
    expect(feed.items.map((item) => item.target.stageId)).toEqual(['a', 'b', 'c'])
  })

  it('важность: блокировка — предупреждение, критичная рекомендация — критично', () => {
    const feed = buildFeed(
      sources({
        stageChanges: [
          {
            historyId: 'h1',
            stageId: 'stage-2',
            stageNumber: 2,
            stageTitle: 'Связь',
            toStatus: 'BLOCKED',
            changedAt: new Date(now.getTime() - DAY),
            cooperationId: 'coop-1',
            universityName: 'СПбГУТ',
            programName: 'ПИ',
            authorName: 'Кириллов Пётр Андреевич',
          },
        ],
        recommendations: [
          {
            id: 'r1',
            ruleKey: 'stage.overdue',
            stageNumber: 7,
            title: 'Просрочен этап 7',
            label: 'СПбГУТ — Программная инженерия',
            priority: 'CRITICAL',
            createdAt: new Date(now.getTime() - 2 * DAY),
            cooperationId: 'coop-1',
          },
          {
            id: 'r2',
            ruleKey: 'skill.critical-gap-with-product',
            stageNumber: null,
            title: 'Дефицит навыка',
            label: 'Навык «Kubernetes»',
            priority: 'HIGH',
            createdAt: new Date(now.getTime() - 4 * DAY),
            cooperationId: null,
          },
        ],
      }),
      { now, since: null, limit: 20 },
    )
    const severity = Object.fromEntries(feed.items.map((item) => [item.id, item.severity]))
    expect(severity).toEqual({ 'stage:h1': 'warning', 'recommendation:r1': 'critical', 'recommendation:r2': 'warning' })
    // Рекомендация называет свой объект: заголовок «Просрочен этап 7» не говорит, где.
    expect(feed.items.find((item) => item.id === 'recommendation:r1')?.description).toBe(
      'СПбГУТ — Программная инженерия',
    )
    const blocked = feed.items.find((item) => item.id === 'stage:h1')
    expect(blocked?.title).toContain('заблокирован')
    expect(blocked?.description).toContain('Кириллов Пётр Андреевич')
  })

  it('документ ведёт к документу', () => {
    const feed = buildFeed(
      sources({
        documentChanges: [
          {
            historyId: 'd1',
            documentId: 'doc-1',
            title: 'Договор о сотрудничестве',
            version: '1.0',
            toStatus: 'SIGNED',
            changedAt: new Date(now.getTime() - DAY),
            cooperationId: 'coop-1',
            universityName: 'СПбГУТ',
          },
        ],
      }),
      { now, since: null, limit: 20 },
    )
    expect(feed.items[0]?.target).toEqual({
      type: 'document',
      id: 'doc-1',
      cooperationId: 'coop-1',
      stageId: null,
    })
  })

  it('id постоянный: одно событие — один id при каждом запросе', () => {
    const first = buildFeed(sources({ deadlines: [stage({})] }), { now, since: null, limit: 20 })
    const second = buildFeed(sources({ deadlines: [stage({})] }), {
      now: new Date(now.getTime() + 60_000),
      since: null,
      limit: 20,
    })
    expect(first.items[0]?.id).toBe(second.items[0]?.id)
  })

  it('одна просрочка — одно уведомление: остаётся срок этапа, рекомендация о нём не дублирует', () => {
    const deadline = new Date(now.getTime() - 5 * DAY)
    const feed = buildFeed(
      sources({
        deadlines: [stage({ deadline, stageNumber: 5, stageId: 'stage-5' })],
        recommendations: [recommendation({ id: 'r5', stageNumber: 5, title: 'Просрочен этап 5: Доработка' })],
      }),
      { now, since: null, limit: 20 },
    )
    expect(feed.items.map((item) => item.id)).toEqual(['stage-overdue:stage-5'])
    expect(feed.items[0]?.target.stageId).toBe('stage-5')
  })

  it('пересборка не выдаёт известную просрочку за новую', () => {
    // Сотрудник видел ленту вчера; сегодня пересборка создала рекомендацию
    // о той же просрочке — непрочитанного не прибавилось.
    const deadline = new Date(now.getTime() - 5 * DAY)
    const since = new Date(now.getTime() - DAY)
    const before = buildFeed(sources({ deadlines: [stage({ deadline })] }), { now, since, limit: 20 })
    const after = buildFeed(
      sources({ deadlines: [stage({ deadline })], recommendations: [recommendation({ createdAt: now })] }),
      { now, since, limit: 20 },
    )
    expect(before.unreadCount).toBe(0)
    expect(after.unreadCount).toBe(0)
  })

  it('рекомендация о просрочке остаётся, если о сроке этапа лента не знает', () => {
    // Этап ведёт другой сотрудник, а связка — моя: пункта срока у меня нет.
    const feed = buildFeed(sources({ recommendations: [recommendation({})] }), { now, since: null, limit: 20 })
    expect(feed.items.map((item) => item.kind)).toEqual(['recommendation'])
  })

  it('рекомендация о другом этапе или другой связке не склеивается', () => {
    const feed = buildFeed(
      sources({
        deadlines: [stage({ stageNumber: 6 })],
        recommendations: [
          recommendation({ id: 'other-stage', stageNumber: 3 }),
          recommendation({ id: 'other-coop', cooperationId: 'coop-2' }),
        ],
      }),
      { now, since: null, limit: 20 },
    )
    expect(feed.items).toHaveLength(3)
  })

  it('этап за незавершённой контрольной точкой не даёт ни просрочки, ни «скоро срок»', () => {
    const feed = buildFeed(
      sources({
        deadlines: [
          stage({ stageId: 'late', status: 'NOT_STARTED', lockedByControlPoint: true }),
          stage({
            stageId: 'soon',
            status: 'NOT_STARTED',
            deadline: new Date(now.getTime() + DAY),
            lockedByControlPoint: true,
          }),
        ],
      }),
      { now, since: null, limit: 20 },
    )
    expect(feed.items).toEqual([])
    expect(feed.unreadCount).toBe(0)
  })
})

describe('назначение ответственного за вуз (ТЗ, решение 146)', () => {
  it('назначение и снятие — разные заголовки и ведут на карточку вуза', () => {
    const feed = buildFeed(
      sources({
        responsibleAssignments: [
          {
            auditLogId: 'log-1',
            universityId: 'uni-1',
            universityName: 'СПбГУТ',
            assigned: true,
            changedAt: now,
          },
          {
            auditLogId: 'log-2',
            universityId: 'uni-2',
            universityName: 'ИТМО',
            assigned: false,
            changedAt: now,
          },
        ],
      }),
      { now, since: null, limit: 20 },
    )
    expect(feed.items).toHaveLength(2)
    const assigned = feed.items.find((item) => item.id === 'responsible:log-1')
    const removed = feed.items.find((item) => item.id === 'responsible:log-2')
    expect(assigned?.title).toContain('назначены ответственным')
    expect(assigned?.target).toEqual({ type: 'university', id: 'uni-1', cooperationId: null, stageId: null })
    expect(removed?.title).toContain('больше не ответственный')
  })
})
