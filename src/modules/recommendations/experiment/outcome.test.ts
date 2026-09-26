import { describe, expect, it } from 'vitest'
import { cappedDays, evaluateOutcome, programIdsOf, type OutcomeFacts } from './outcome'

/**
 * Исход сигнала (решение 126): связка перешла на следующий этап, или у программы
 * появилась связка/встреча, — в окне H дней после сигнала.
 */

const FIRED_AT = new Date('2026-06-01T00:00:00.000Z')
const DAY_MS = 24 * 60 * 60 * 1000
const at = (daysAfterFire: number) => new Date(FIRED_AT.getTime() + daysAfterFire * DAY_MS)

describe('evaluateOutcome — связки', () => {
  it('текущий этап закрылся в пределах окна — success с точным числом дней', () => {
    const facts: OutcomeFacts = {
      stageClosures: new Map([['coop-1', [{ stageNumber: 6, at: at(5) }]]]),
      programEvents: new Map(),
    }
    const outcome = evaluateOutcome(
      { entityType: 'Cooperation', entityId: 'coop-1', firedAt: FIRED_AT, context: { stageNumber: 6 } },
      facts,
      at(20),
      30,
    )
    expect(outcome.state).toBe('success')
    expect(outcome.event).toBe('stage-advance')
    expect(outcome.days).toBeCloseTo(5, 6)
  })

  it('закрылся другой этап, не текущий на момент сигнала, — не считается переходом', () => {
    const facts: OutcomeFacts = {
      stageClosures: new Map([['coop-1', [{ stageNumber: 9, at: at(5) }]]]),
      programEvents: new Map(),
    }
    const outcome = evaluateOutcome(
      { entityType: 'Cooperation', entityId: 'coop-1', firedAt: FIRED_AT, context: { stageNumber: 6 } },
      facts,
      at(31),
      30,
    )
    expect(outcome.state).toBe('failure')
  })

  it('окно ещё не закрылось и события не было — pending', () => {
    const facts: OutcomeFacts = { stageClosures: new Map(), programEvents: new Map() }
    const outcome = evaluateOutcome(
      { entityType: 'Cooperation', entityId: 'coop-1', firedAt: FIRED_AT, context: { stageNumber: 6 } },
      facts,
      at(10),
      30,
    )
    expect(outcome.state).toBe('pending')
  })

  it('окно закрылось без перехода — failure ровно на границе окна', () => {
    const facts: OutcomeFacts = { stageClosures: new Map(), programEvents: new Map() }
    const outcome = evaluateOutcome(
      { entityType: 'Cooperation', entityId: 'coop-1', firedAt: FIRED_AT, context: { stageNumber: 6 } },
      facts,
      at(30),
      30,
    )
    expect(outcome.state).toBe('failure')
  })

  it('переход случился до сигнала или ровно в момент сигнала — не считается (окно открыто строго после)', () => {
    const facts: OutcomeFacts = {
      stageClosures: new Map([['coop-1', [{ stageNumber: 6, at: FIRED_AT }]]]),
      programEvents: new Map(),
    }
    const outcome = evaluateOutcome(
      { entityType: 'Cooperation', entityId: 'coop-1', firedAt: FIRED_AT, context: { stageNumber: 6 } },
      facts,
      at(30),
      30,
    )
    expect(outcome.state).toBe('failure')
  })

  it('несколько закрытий — берётся первое в пределах окна', () => {
    const facts: OutcomeFacts = {
      stageClosures: new Map([
        ['coop-1', [{ stageNumber: 6, at: at(20) }, { stageNumber: 6, at: at(3) }]],
      ]),
      programEvents: new Map(),
    }
    const outcome = evaluateOutcome(
      { entityType: 'Cooperation', entityId: 'coop-1', firedAt: FIRED_AT, context: { stageNumber: 6 } },
      facts,
      at(25),
      30,
    )
    expect(outcome.days).toBeCloseTo(3, 6)
  })
})

describe('evaluateOutcome — программы и навыки', () => {
  it('появилась новая связка по программе — успех', () => {
    const facts: OutcomeFacts = {
      stageClosures: new Map(),
      programEvents: new Map([['prog-1', [{ at: at(10), kind: 'cooperation' }]]]),
    }
    const outcome = evaluateOutcome(
      { entityType: 'EducationalProgram', entityId: 'prog-1', firedAt: FIRED_AT, context: null },
      facts,
      at(20),
      30,
    )
    expect(outcome.state).toBe('success')
    expect(outcome.event).toBe('cooperation')
  })

  it('навык — событие по любой из программ, которым его не хватает', () => {
    const facts: OutcomeFacts = {
      stageClosures: new Map(),
      programEvents: new Map([['prog-2', [{ at: at(7), kind: 'meeting' }]]]),
    }
    const outcome = evaluateOutcome(
      {
        entityType: 'Skill',
        entityId: 'skill-1',
        firedAt: FIRED_AT,
        context: { programIds: ['prog-1', 'prog-2'] },
      },
      facts,
      at(20),
      30,
    )
    expect(outcome.state).toBe('success')
    expect(outcome.event).toBe('meeting')
  })

  it('навык без программ в контексте — исход неопределим по данным, но не падает', () => {
    const facts: OutcomeFacts = { stageClosures: new Map(), programEvents: new Map() }
    const outcome = evaluateOutcome(
      { entityType: 'Skill', entityId: 'skill-1', firedAt: FIRED_AT, context: null },
      facts,
      at(31),
      30,
    )
    expect(outcome.state).toBe('failure')
  })

  it('неизвестный тип объекта — unsupported', () => {
    const facts: OutcomeFacts = { stageClosures: new Map(), programEvents: new Map() }
    const outcome = evaluateOutcome(
      { entityType: 'University', entityId: 'u-1', firedAt: FIRED_AT, context: null },
      facts,
      at(1),
      30,
    )
    expect(outcome.state).toBe('unsupported')
  })
})

describe('programIdsOf', () => {
  it('для программы — сама программа', () => {
    expect(programIdsOf({ entityType: 'EducationalProgram', entityId: 'p-1', context: null })).toEqual(['p-1'])
  })
  it('для навыка — программы из контекста, пусто если их нет', () => {
    expect(programIdsOf({ entityType: 'Skill', entityId: 's-1', context: { programIds: ['p-1', 'p-2'] } })).toEqual([
      'p-1',
      'p-2',
    ])
    expect(programIdsOf({ entityType: 'Skill', entityId: 's-1', context: null })).toEqual([])
  })
  it('для связки — пусто', () => {
    expect(programIdsOf({ entityType: 'Cooperation', entityId: 'c-1', context: null })).toEqual([])
  })
})

describe('cappedDays — дни до сдвига для сравнения средних', () => {
  it('успех раньше окна — фактическое число дней', () => {
    expect(cappedDays({ state: 'success', days: 5, event: 'stage-advance', at: at(5) }, 30)).toBe(5)
  })
  it('неудача — ровно длина окна (не сдвинулся вовсе, но всё равно входит в среднее)', () => {
    expect(cappedDays({ state: 'failure', days: null, event: null, at: at(30) }, 30)).toBe(30)
  })
  it('ожидание — не входит в сравнение (null)', () => {
    expect(cappedDays({ state: 'pending', days: null, event: null, at: null }, 30)).toBeNull()
  })
})
