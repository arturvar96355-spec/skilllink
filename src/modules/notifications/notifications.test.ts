import { describe, expect, it } from 'vitest'

import { DEADLINE_WARNING_DAYS } from '@/shared/config/analytics.config'
import { buildFeed, type FeedSources, type StageDeadlineSource } from './notifications.rules'

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
    ...overrides,
  }
}

function sources(overrides: Partial<FeedSources> = {}): FeedSources {
  return { deadlines: [], stageChanges: [], documentChanges: [], recommendations: [], ...overrides }
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
            title: 'Просрочен этап 7',
            label: 'СПбГУТ — Программная инженерия',
            priority: 'CRITICAL',
            createdAt: new Date(now.getTime() - 2 * DAY),
            cooperationId: 'coop-1',
          },
          {
            id: 'r2',
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
})
