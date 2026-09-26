import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AI_PROPOSAL } from '@/shared/config/ai-assist.config'
import type { CurrentUser } from '@/shared/auth/current-user'
import type { CooperationDto } from '@/shared/contracts/cooperation'
import type { MeetingDto } from '@/shared/contracts/meeting'
import type { WorkflowStageDto } from '@/shared/contracts/workflow'
import type { LlmCompletion, LlmProvider, LlmProviderInfo } from '@/integrations/llm'

/**
 * «История сотрудничества», «Что мешает», «Предложить план» (решение 138).
 *
 * Сети и базы здесь нет: сервисы связки, вузов, встреч, этапов и рекомендаций —
 * подменены. Проверяется главное: без провайдера или при его сбое отдаётся
 * шаблон, а не ошибка; ответ модели с числом не из фактов отбрасывается; права
 * соблюдаются; проект плана ничего не пишет, а применение — версию и права
 * проверяет заново и один раз использует проект.
 */

const mocks = vi.hoisted(() => ({
  getCooperation: vi.fn(),
  listCooperations: vi.fn(),
  getUniversity: vi.fn(),
  listMeetings: vi.fn(),
  createMeeting: vi.fn(),
  listRecommendations: vi.fn(),
  updateStage: vi.fn(),
  findRedactionContext: vi.fn(),
  findDocumentsSummary: vi.fn(),
  writeAudit: vi.fn(),
  getLlmProvider: vi.fn(),
}))

vi.mock('@/modules/cooperation/cooperation.service', () => ({
  getById: mocks.getCooperation,
  list: mocks.listCooperations,
}))
vi.mock('@/modules/universities/universities.service', () => ({ getById: mocks.getUniversity }))
vi.mock('@/modules/meetings/meetings.service', () => ({ list: mocks.listMeetings, create: mocks.createMeeting }))
vi.mock('@/modules/recommendations/recommendations.service', () => ({ list: mocks.listRecommendations }))
vi.mock('@/modules/workflow/workflow.service', () => ({ updateStage: mocks.updateStage }))
vi.mock('./ai-assist.repo', () => ({ findRedactionContext: mocks.findRedactionContext }))
vi.mock('./ai-story.repo', () => ({ findDocumentsSummary: mocks.findDocumentsSummary }))
vi.mock('@/shared/audit/audit', () => ({ writeAudit: mocks.writeAudit }))
vi.mock('@/integrations/llm', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/integrations/llm')>()
  return { ...original, getLlmProvider: mocks.getLlmProvider }
})

const { getCooperationStory, getCooperationBlockers, createProposal, applyProposal } = await import(
  './ai-story.service'
)
const { resetAiAssistLimits } = await import('./ai-assist.limits')
const { resetAiProposals } = await import('./ai-story.proposals')

const NOW = new Date('2026-09-28T09:00:00.000Z')

function user(role: CurrentUser['role'], overrides: Partial<CurrentUser> = {}): CurrentUser {
  return { id: 'u1', email: 'manager@skilllink.demo', fullName: 'Менеджер', role, universityId: null, ...overrides }
}

const MANAGER = user('MANAGER')
const REP = user('UNIVERSITY_REP', { universityId: 'univ-1' })

function stage(overrides: Partial<WorkflowStageDto> & { stageNumber: number }): WorkflowStageDto {
  return {
    id: `stage-${overrides.stageNumber}`,
    cooperationId: 'coop-1',
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

function cooperation(overrides: Partial<CooperationDto> = {}): CooperationDto {
  return {
    id: 'coop-1',
    universityId: 'univ-1',
    universityName: 'Санкт-Петербургский государственный университет телекоммуникаций',
    universityShortName: 'СПбГУТ',
    programId: 'prog-1',
    programName: 'Программная инженерия',
    productId: 'prod-1',
    productName: 'Курс «Основы разработки»',
    status: 'ACTIVE',
    responsible: { id: 'u1', fullName: 'Менеджер Менеджерович', role: 'MANAGER' },
    currentStage: null,
    progress: { percent: 30, completedStages: 3, cancelledStages: 0, totalStages: 13, overdueStages: 0, dueSoonStages: 0, blockedStages: 0 },
    targetDate: null,
    classesStartAt: '2026-09-01T00:00:00.000Z',
    daysToTarget: null,
    isMock: false,
    updatedAt: '2026-09-20T00:00:00.000Z',
    goal: null,
    notes: null,
    firstContactAt: null,
    startedAt: '2026-01-01T00:00:00.000Z',
    closedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    stages: [stage({ stageNumber: 4, status: 'IN_PROGRESS' })],
    contractNumber: null,
    licenseSignedAt: null,
    licenseTermYears: null,
    transferStatus: null,
    comment: null,
    ...overrides,
  }
}

function offProvider(): LlmProvider {
  return {
    info: (): LlmProviderInfo => ({ kind: 'off', name: 'Выключен', ready: false, reason: null, model: null }),
    generate: vi.fn(),
  }
}

function readyProvider(reply: (request: { system: string; user: string }) => LlmCompletion): LlmProvider {
  return {
    info: (): LlmProviderInfo => ({ kind: 'yandexgpt', name: 'YandexGPT', ready: true, reason: null, model: 'yandexgpt/latest' }),
    generate: vi.fn(async (request) => reply(request)),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  resetAiAssistLimits()
  resetAiProposals()
  mocks.findRedactionContext.mockResolvedValue({ people: { staff: [], contacts: [] }, universityNames: [] })
  mocks.findDocumentsSummary.mockResolvedValue({ signed: 0, total: 0 })
  mocks.listMeetings.mockResolvedValue({ data: [], meta: { page: 1, pageSize: 1, total: 0 } })
  mocks.listRecommendations.mockResolvedValue({ data: [], meta: { page: 1, pageSize: 1, total: 0 } })
  mocks.getLlmProvider.mockReturnValue(offProvider())
})

afterEach(() => {
  vi.useRealTimers()
})

describe('getCooperationStory', () => {
  it('представителю вуза недоступно (право ANALYTICS, как у ИИ-помощника решения 90)', async () => {
    await expect(getCooperationStory(REP, 'coop-1')).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('без провайдера — шаблон, а не ошибка', async () => {
    mocks.getCooperation.mockResolvedValue(cooperation())
    const draft = await getCooperationStory(MANAGER, 'coop-1')
    expect(draft.source).toBe('template')
    expect(draft.fallbackReason).toBe('disabled')
    expect(draft.text.length).toBeGreaterThan(0)
    expect(draft.dataAsOf).toBe('2026-09-20T00:00:00.000Z')
  })

  it('модель ответила по фактам — источник «model», журнал ai.story и ai.request записаны', async () => {
    mocks.getCooperation.mockResolvedValue(cooperation())
    mocks.getLlmProvider.mockReturnValue(
      readyProvider(() => ({ text: 'Связка развивается по плану. Пройдено 3 из 13 этапов. Ничего не мешает.', model: 'yandexgpt/latest' })),
    )
    const draft = await getCooperationStory(MANAGER, 'coop-1')
    expect(draft.source).toBe('model')
    expect(draft.provider).toBe('yandexgpt')
    expect(draft.fallbackReason).toBeNull()

    const actions = mocks.writeAudit.mock.calls.map((call) => call[0].action)
    expect(actions).toContain('ai.story')
    expect(actions).toContain('ai.request')
  })

  it('модель придумала число не из фактов — отбрасывается, отдан шаблон', async () => {
    mocks.getCooperation.mockResolvedValue(cooperation())
    mocks.getLlmProvider.mockReturnValue(
      readyProvider(() => ({ text: 'Пройдено 999 из 13 этапов. Всё по плану. Ничего не мешает.', model: 'yandexgpt/latest' })),
    )
    const draft = await getCooperationStory(MANAGER, 'coop-1')
    expect(draft.source).toBe('template')
    expect(draft.fallbackReason).toBe('invalid')
  })

  it('модель ответила пустотой — отдан шаблон с причиной empty', async () => {
    mocks.getCooperation.mockResolvedValue(cooperation())
    mocks.getLlmProvider.mockReturnValue(readyProvider(() => ({ text: '   ', model: 'yandexgpt/latest' })))
    const draft = await getCooperationStory(MANAGER, 'coop-1')
    expect(draft.source).toBe('template')
    expect(draft.fallbackReason).toBe('empty')
  })

  it('модель упала — отдан шаблон, запрос не считается ошибкой', async () => {
    mocks.getCooperation.mockResolvedValue(cooperation())
    mocks.getLlmProvider.mockReturnValue({
      info: (): LlmProviderInfo => ({ kind: 'yandexgpt', name: 'YandexGPT', ready: true, reason: null, model: 'yandexgpt/latest' }),
      generate: vi.fn().mockRejectedValue(new Error('сеть недоступна')),
    })
    const draft = await getCooperationStory(MANAGER, 'coop-1')
    expect(draft.source).toBe('template')
    expect(draft.fallbackReason).toBe('failed')
  })
})

describe('getCooperationBlockers', () => {
  it('представителю вуза недоступно', async () => {
    await expect(getCooperationBlockers(REP, 'coop-1')).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('возвращает препятствия и dataAsOf связки', async () => {
    mocks.getCooperation.mockResolvedValue(
      cooperation({ stages: [stage({ stageNumber: 4, status: 'BLOCKED', blockingReason: 'Ждём документы' })] }),
    )
    const result = await getCooperationBlockers(MANAGER, 'coop-1')
    expect(result.blockers[0]!.code).toBe('STAGE_BLOCKED')
    expect(result.dataAsOf).toBe('2026-09-20T00:00:00.000Z')
  })
})

describe('createProposal', () => {
  it('закрытая связка — 409', async () => {
    mocks.getCooperation.mockResolvedValue(cooperation({ status: 'COMPLETED' }))
    await expect(createProposal(MANAGER, 'coop-1', {})).rejects.toMatchObject({ code: 'CONFLICT' })
  })

  it('все этапы закрыты — предлагать нечего, 409', async () => {
    mocks.getCooperation.mockResolvedValue(cooperation({ stages: [], currentStage: null }))
    await expect(createProposal(MANAGER, 'coop-1', {})).rejects.toMatchObject({ code: 'CONFLICT' })
  })

  it('представитель вуза не может предложить план', async () => {
    mocks.getCooperation.mockResolvedValue(cooperation())
    await expect(createProposal(REP, 'coop-1', {})).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('есть препятствия — проект встречи с датой не раньше чем через 3 рабочих дня', async () => {
    mocks.getCooperation.mockResolvedValue(
      cooperation({ stages: [stage({ stageNumber: 4, status: 'BLOCKED', blockingReason: 'Ждём документы' })] }),
    )
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    const proposal = await createProposal(MANAGER, 'coop-1', {})
    expect(proposal.kind).toBe('meeting')
    expect(proposal.payload.kind).toBe('meeting')
    expect(proposal.sourceVersion).toBe('2026-09-20T00:00:00.000Z')
    expect(new Date(proposal.expiresAt).getTime()).toBeGreaterThan(NOW.getTime())
  })

  it('препятствий нет — проект новой даты этапа', async () => {
    mocks.getCooperation.mockResolvedValue(
      cooperation({ stages: [stage({ stageNumber: 4, status: 'IN_PROGRESS', requiredTasksTotal: 1, requiredTasksDone: 1, result: 'Сделано' })] }),
    )
    const proposal = await createProposal(MANAGER, 'coop-1', {})
    expect(proposal.kind).toBe('task')
    expect(proposal.payload.kind).toBe('task')
  })
})

describe('applyProposal', () => {
  async function proposalFor(cooperationOverrides: Partial<CooperationDto> = {}) {
    mocks.getCooperation.mockResolvedValue(cooperation(cooperationOverrides))
    return createProposal(MANAGER, 'coop-1', {})
  }

  it('проекта нет — 404', async () => {
    await expect(applyProposal(MANAGER, 'coop-1', 'нет-такого')).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('проект истёк — 404, как будто его не было', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    const proposal = await proposalFor()
    vi.setSystemTime(new Date(NOW.getTime() + AI_PROPOSAL.ttlMs + 1000))
    await expect(applyProposal(MANAGER, 'coop-1', proposal.proposalId)).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('связка изменилась после постройки проекта — 409', async () => {
    const proposal = await proposalFor()
    mocks.getCooperation.mockResolvedValue(cooperation({ updatedAt: '2026-09-25T00:00:00.000Z' }))
    await expect(applyProposal(MANAGER, 'coop-1', proposal.proposalId)).rejects.toMatchObject({ code: 'CONFLICT' })
  })

  it('применение задачи переносит срок этапа штатным сервисом', async () => {
    const proposal = await proposalFor({
      stages: [stage({ stageNumber: 4, status: 'IN_PROGRESS', requiredTasksTotal: 1, requiredTasksDone: 1, result: 'Сделано' })],
    })
    mocks.updateStage.mockResolvedValue(stage({ stageNumber: 4, status: 'IN_PROGRESS' }))
    const applied = await applyProposal(MANAGER, 'coop-1', proposal.proposalId)
    expect(applied.kind).toBe('task')
    expect(mocks.updateStage).toHaveBeenCalledWith(MANAGER, 'stage-4', expect.objectContaining({ deadline: expect.any(String) }))

    const actions = mocks.writeAudit.mock.calls.map((call) => call[0].action)
    expect(actions).toContain('ai.proposal.applied')
  })

  it('применение встречи создаёт её штатным сервисом и проект использует один раз', async () => {
    const proposal = await proposalFor({
      stages: [stage({ stageNumber: 4, status: 'BLOCKED', blockingReason: 'Ждём документы' })],
    })
    const meetingDto = { id: 'meeting-1' } as MeetingDto
    mocks.createMeeting.mockResolvedValue(meetingDto)
    const applied = await applyProposal(MANAGER, 'coop-1', proposal.proposalId)
    expect(applied.kind).toBe('meeting')
    expect(applied.meeting).toBe(meetingDto)
    expect(mocks.createMeeting).toHaveBeenCalledTimes(1)

    await expect(applyProposal(MANAGER, 'coop-1', proposal.proposalId)).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})
