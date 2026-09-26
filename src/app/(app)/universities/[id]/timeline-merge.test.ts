import { describe, expect, it } from 'vitest'
import type { TimelineEventDto } from '@/shared/contracts'
import { mergeTimelinePage } from './timeline-merge'

function event(id: string): TimelineEventDto {
  return {
    id,
    type: 'stage',
    kind: 'stage.status',
    title: `Событие ${id}`,
    details: null,
    cooperationId: null,
    programName: null,
    href: null,
    author: null,
    occurredAt: '2026-09-26T00:00:00.000Z',
  }
}

describe('timeline-merge: mergeTimelinePage', () => {
  it('cursor = null (первая страница) заменяет список целиком, а не дописывает к нему', () => {
    const previous = [event('a'), event('b')]
    const page = [event('c')]
    expect(mergeTimelinePage(previous, page, null)).toEqual(page)
  })

  it('непустой cursor («Показать ещё») дописывает страницу в конец', () => {
    const previous = [event('a'), event('b')]
    const page = [event('c'), event('d')]
    expect(mergeTimelinePage(previous, page, 'MjAyNi0…')).toEqual([...previous, ...page])
  })

  it('смена фильтра (cursor сброшен в null) стирает события другого типа, а не смешивает их', () => {
    const previousFilteredByMeeting = [event('meeting-1'), event('meeting-2')]
    const firstPageOfStages = [event('stage-1')]
    expect(mergeTimelinePage(previousFilteredByMeeting, firstPageOfStages, null)).toEqual(firstPageOfStages)
  })

  it('первая страница при пустой ленте — просто сама страница', () => {
    expect(mergeTimelinePage([], [event('a')], null)).toEqual([event('a')])
  })
})
