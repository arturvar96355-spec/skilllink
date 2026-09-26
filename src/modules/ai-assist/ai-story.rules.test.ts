import { describe, expect, it } from 'vitest'
import type { StageStatus } from '@/shared/contracts/enums'
import type { WorkflowStageDto } from '@/shared/contracts/workflow'
import {
  buildAgenda,
  buildMeetingTopic,
  chooseProposalKind,
  computeBlockers,
  cooperationStoryTemplate,
  countSentences,
  nextWorkingDay,
  pickMainBlocker,
  type CooperationStoryFacts,
} from './ai-story.rules'

/**
 * «Что мешает» и «История сотрудничества» (решение 138): правила без базы и без
 * модели — важна только логика.
 */

function stage(overrides: Partial<WorkflowStageDto> & { stageNumber: number }): WorkflowStageDto {
  return {
    id: `stage-${overrides.stageNumber}`,
    cooperationId: 'c1',
    title: `Этап ${overrides.stageNumber}`,
    phase: 'ATTRACTION',
    status: 'NOT_STARTED',
    responsible: null,
    deadline: null,
    isOverdue: false,
    isPlanShifted: false,
    isDueSoon: false,
    daysToDeadline: null,
    comment: null,
    result: null,
    blockingReason: null,
    startedAt: null,
    completedAt: null,
    completedBy: null,
    isAutoManaged: false,
    tasks: [],
    requiredTasksTotal: 0,
    requiredTasksDone: 0,
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  }
}

function closedStages(numbers: readonly number[], status: StageStatus = 'COMPLETED'): WorkflowStageDto[] {
  return numbers.map((stageNumber) => stage({ stageNumber, status, result: status === 'COMPLETED' ? 'Готово' : null }))
}

describe('computeBlockers', () => {
  it('закрытая связка: единственный блокер — COOPERATION_CLOSED', () => {
    const blockers = computeBlockers({
      cooperation: { id: 'c1', status: 'COMPLETED', productId: 'p1', stages: closedStages([1, 2, 3]) },
      documents: { signed: 0, total: 0 },
    })
    expect(blockers).toHaveLength(1)
    expect(blockers[0]!.code).toBe('COOPERATION_CLOSED')
    expect(blockers[0]!.stageNumber).toBeNull()
  })

  it('приостановленная связка: COOPERATION_PAUSED идёт первым, но не единственным', () => {
    const stages = [...closedStages([1]), stage({ stageNumber: 2, status: 'IN_PROGRESS' })]
    const blockers = computeBlockers({
      cooperation: { id: 'c1', status: 'PAUSED', productId: 'p1', stages },
      documents: { signed: 0, total: 0 },
    })
    expect(blockers[0]!.code).toBe('COOPERATION_PAUSED')
  })

  it('заблокированный этап — STAGE_BLOCKED с причиной', () => {
    const stages = [stage({ stageNumber: 1, status: 'BLOCKED', blockingReason: 'Ждём ответ вуза' })]
    const blockers = computeBlockers({
      cooperation: { id: 'c1', status: 'ACTIVE', productId: null, stages },
      documents: { signed: 0, total: 0 },
    })
    expect(blockers[0]!.code).toBe('STAGE_BLOCKED')
    expect(blockers[0]!.detail).toContain('Ждём ответ вуза')
  })

  it('этап не начат и заперт контрольной точкой — CONTROL_POINT, а не STAGE_NOT_STARTED', () => {
    // Отменённая контрольная точка не пройдена (workflow.rules.ts): 6 отменён, а не
    // завершён, значит следующая точка, этап 7, всё равно заперта.
    const stages = [
      stage({ stageNumber: 6, status: 'CANCELLED', comment: 'Не потребовалось' }),
      stage({ stageNumber: 7, status: 'NOT_STARTED' }),
    ]
    const blockers = computeBlockers({
      cooperation: { id: 'c1', status: 'ACTIVE', productId: 'p1', stages },
      documents: { signed: 0, total: 0 },
    })
    expect(blockers.map((item) => item.code)).toContain('CONTROL_POINT')
    expect(blockers.map((item) => item.code)).not.toContain('STAGE_NOT_STARTED')
  })

  it('дошли до оформления без продукта — PRODUCT_NOT_SELECTED', () => {
    const stages = [...closedStages([1, 2, 3]), stage({ stageNumber: 4, status: 'IN_PROGRESS' })]
    const blockers = computeBlockers({
      cooperation: { id: 'c1', status: 'ACTIVE', productId: null, stages },
      documents: { signed: 0, total: 0 },
    })
    expect(blockers.map((item) => item.code)).toContain('PRODUCT_NOT_SELECTED')
  })

  it('этап подписания без подписанных документов — DOCUMENTS_NOT_SIGNED', () => {
    const stages = [stage({ stageNumber: 6, status: 'IN_PROGRESS' })]
    const blockers = computeBlockers({
      cooperation: { id: 'c1', status: 'ACTIVE', productId: 'p1', stages },
      documents: { signed: 0, total: 2 },
    })
    expect(blockers.map((item) => item.code)).toContain('DOCUMENTS_NOT_SIGNED')
  })

  it('подписанный документ снимает DOCUMENTS_NOT_SIGNED', () => {
    const stages = [stage({ stageNumber: 6, status: 'IN_PROGRESS' })]
    const blockers = computeBlockers({
      cooperation: { id: 'c1', status: 'ACTIVE', productId: 'p1', stages },
      documents: { signed: 1, total: 2 },
    })
    expect(blockers.map((item) => item.code)).not.toContain('DOCUMENTS_NOT_SIGNED')
  })

  it('пункт вуза ждёт представителя — UNIVERSITY_ITEM_PENDING, без дубля REQUIRED_TASKS_OPEN', () => {
    const stages = [
      stage({
        stageNumber: 7,
        status: 'IN_PROGRESS',
        requiredTasksTotal: 1,
        requiredTasksDone: 0,
        tasks: [
          {
            id: 't1',
            title: 'Вуз подтвердил получение материалов',
            isRequired: true,
            isDone: false,
            doneAt: null,
            doneBy: null,
            sortOrder: 0,
            isUniversityItem: true,
            staffMarkRule: 'UNIVERSITY_ONLY',
            confirmationNote: null,
          },
        ],
      }),
    ]
    const blockers = computeBlockers({
      cooperation: { id: 'c1', status: 'ACTIVE', productId: 'p1', stages },
      documents: { signed: 2, total: 2 },
    })
    const codes = blockers.map((item) => item.code)
    expect(codes).toContain('UNIVERSITY_ITEM_PENDING')
    expect(codes).not.toContain('REQUIRED_TASKS_OPEN')
  })

  it('не закрыт обычный обязательный пункт — REQUIRED_TASKS_OPEN', () => {
    const stages = [stage({ stageNumber: 8, status: 'IN_PROGRESS', requiredTasksTotal: 2, requiredTasksDone: 1 })]
    const blockers = computeBlockers({
      cooperation: { id: 'c1', status: 'ACTIVE', productId: 'p1', stages },
      documents: { signed: 0, total: 0 },
    })
    expect(blockers.map((item) => item.code)).toContain('REQUIRED_TASKS_OPEN')
  })

  it('пункты закрыты, результата нет — RESULT_MISSING', () => {
    const stages = [
      stage({ stageNumber: 9, status: 'IN_PROGRESS', requiredTasksTotal: 1, requiredTasksDone: 1, result: null }),
    ]
    const blockers = computeBlockers({
      cooperation: { id: 'c1', status: 'ACTIVE', productId: 'p1', stages },
      documents: { signed: 0, total: 0 },
    })
    expect(blockers.map((item) => item.code)).toContain('RESULT_MISSING')
  })

  it('этап не начат и ничем не заперт — STAGE_NOT_STARTED', () => {
    const stages = [stage({ stageNumber: 3, status: 'NOT_STARTED' })]
    const blockers = computeBlockers({
      cooperation: { id: 'c1', status: 'ACTIVE', productId: null, stages },
      documents: { signed: 0, total: 0 },
    })
    expect(blockers.map((item) => item.code)).toContain('STAGE_NOT_STARTED')
  })

  it('следующий этап — контрольная точка, и её держит ещё и другой этап, — NEXT_CONTROL_POINT', () => {
    // Текущий — этап 4 (сам не заперт), следующий открытый — контрольная точка 7.
    // Её держит не только текущий этап, но и отменённая (не пройденная) точка 6.
    const stages = [
      stage({ stageNumber: 4, status: 'IN_PROGRESS' }),
      stage({ stageNumber: 6, status: 'CANCELLED', comment: 'Не потребовалось' }),
      stage({ stageNumber: 7, status: 'NOT_STARTED' }),
    ]
    const blockers = computeBlockers({
      cooperation: { id: 'c1', status: 'ACTIVE', productId: 'p1', stages },
      documents: { signed: 0, total: 0 },
    })
    expect(blockers.map((item) => item.code)).toContain('NEXT_CONTROL_POINT')
  })

  it('без препятствий — пустой список', () => {
    const stages = [stage({ stageNumber: 2, status: 'IN_PROGRESS', requiredTasksTotal: 1, requiredTasksDone: 1, result: 'Сделано' })]
    const blockers = computeBlockers({
      cooperation: { id: 'c1', status: 'ACTIVE', productId: 'p1', stages },
      documents: { signed: 0, total: 0 },
    })
    expect(blockers).toEqual([])
  })
})

describe('pickMainBlocker', () => {
  it('выбирает препятствие с более ранним кодом в BLOCKER_CODES', () => {
    const main = pickMainBlocker([
      { code: 'STAGE_NOT_STARTED', detail: 'a', link: '/x', stageNumber: 1 },
      { code: 'STAGE_BLOCKED', detail: 'b', link: '/y', stageNumber: 2 },
    ])
    expect(main?.code).toBe('STAGE_BLOCKED')
  })

  it('пустой список — нет главного препятствия', () => {
    expect(pickMainBlocker([])).toBeNull()
  })
})

describe('cooperationStoryTemplate', () => {
  const base: CooperationStoryFacts = {
    universityName: 'Санкт-Петербургский государственный университет телекоммуникаций',
    universityShortName: 'СПбГУТ',
    programName: 'Программная инженерия',
    productName: 'Курс «Основы разработки»',
    status: 'ACTIVE',
    current: { id: 's1', stageNumber: 4, title: 'Обмен документами', status: 'IN_PROGRESS' },
    totalStages: 13,
    closedStages: 3,
    documents: { signed: 0, total: 0 },
    meetings: { total: 2, lastAt: '2026-08-20T10:00:00.000Z' },
    openRecommendations: 1,
    mainBlocker: null,
    classesStartAt: '2026-09-01T00:00:00.000Z',
  }

  it('укладывается в 3–5 предложений', () => {
    const text = cooperationStoryTemplate(base)
    const sentences = countSentences(text)
    expect(sentences).toBeGreaterThanOrEqual(3)
    expect(sentences).toBeLessThanOrEqual(5)
  })

  it('называет главное препятствие, если оно есть', () => {
    const withBlocker: CooperationStoryFacts = {
      ...base,
      mainBlocker: { code: 'STAGE_BLOCKED', detail: 'Этап 4 заблокирован: нет ответа', link: '/x', stageNumber: 4 },
    }
    expect(cooperationStoryTemplate(withBlocker)).toContain('Этап 4 заблокирован: нет ответа')
  })

  it('без препятствий — говорит, что ничего не мешает', () => {
    expect(cooperationStoryTemplate(base)).toMatch(/ничего не мешает/)
  })
})

describe('countSentences', () => {
  it('считает по точке, восклицательному и вопросительному знаку', () => {
    expect(countSentences('Раз. Два! Три?')).toBe(3)
    expect(countSentences('')).toBe(0)
    expect(countSentences('Без знаков препинания')).toBe(1)
  })
})

describe('nextWorkingDay', () => {
  it('в окне 3–5 дней от понедельника — это будни, дата не сдвигается', () => {
    // 2026-09-28 — понедельник.
    const monday = new Date('2026-09-28T09:00:00.000Z')
    const result = nextWorkingDay(monday, 3, 5, [])
    expect(result.extended).toBe(false)
    expect(result.isoDate).toBe('2026-10-01')
  })

  it('пятница в окне — ближайший рабочий день, суббота и воскресенье не в счёт', () => {
    // 2026-10-01 — четверг: +1 день — пятница 2026-10-02, рабочий день.
    const thursday = new Date('2026-10-01T09:00:00.000Z')
    const result = nextWorkingDay(thursday, 1, 3, [])
    expect(result.isoDate).toBe('2026-10-02')
    expect(result.extended).toBe(false)
  })

  it('окно целиком выходные — ищет дальше и предупреждает', () => {
    // 2026-10-01 — четверг: окно 2–3 дня — суббота 2026-10-03 и воскресенье 2026-10-04,
    // оба выходные → первый рабочий день дальше окна, понедельник 2026-10-05.
    const thursday = new Date('2026-10-01T09:00:00.000Z')
    const result = nextWorkingDay(thursday, 2, 3, [])
    expect(result.extended).toBe(true)
    expect(result.isoDate).toBe('2026-10-05')
  })

  it('праздник внутри окна — предупреждение и дата дальше', () => {
    const now = new Date('2026-09-28T09:00:00.000Z')
    // Все дни окна объявлены праздниками — ищем за окном, extended: true.
    const holidays = ['09-29', '09-30', '10-01', '10-02', '10-03']
    const result = nextWorkingDay(now, 1, 5, holidays)
    expect(result.extended).toBe(true)
    expect(holidays).not.toContain(result.isoDate.slice(5))
  })
})

describe('chooseProposalKind', () => {
  it('есть препятствия — meeting', () => {
    expect(chooseProposalKind([{ code: 'STAGE_BLOCKED', detail: 'x', link: '/x', stageNumber: 1 }])).toBe('meeting')
  })

  it('препятствий нет — task', () => {
    expect(chooseProposalKind([])).toBe('task')
  })
})

describe('buildAgenda / buildMeetingTopic', () => {
  it('повестка не длиннее предела и заканчивается следующим шагом', () => {
    const blockers = Array.from({ length: 10 }, (_, index) => ({
      code: 'STAGE_NOT_STARTED' as const,
      detail: `Препятствие ${index}`,
      link: '/x',
      stageNumber: index,
    }))
    const agenda = buildAgenda(blockers)
    expect(agenda.length).toBeLessThanOrEqual(5)
    expect(agenda.at(-1)).toMatch(/следующий шаг/i)
  })

  it('тема встречи обрезается до предела поля в базе', () => {
    const agenda = Array.from({ length: 4 }, (_, index) => 'Очень длинный пункт повестки '.repeat(5) + index)
    const topic = buildMeetingTopic('СПбГУТ — «Программная инженерия»', agenda)
    expect(topic.length).toBeLessThanOrEqual(300)
  })
})
