import { beforeEach, describe, expect, it, vi } from 'vitest'
import { expectRejectCode } from '@/shared/testing/expect-code'
import type { CurrentUser } from '@/shared/auth/current-user'
import type { InboundLetterGroup, InboundLetterStatus, UserRole } from '@/shared/contracts/enums'

/**
 * Письма вузов (решение 170) — сервис без базы: репозиторий, журнал и контекст
 * маскирования подменены (как `ai-assist.test.ts`). Модель не подключена в тестовом
 * окружении (`AI_ASSIST_PROVIDER` не задан) — `compose()` всегда отдаёт шаблон
 * (правила), поэтому разбор в тестах детерминирован без подмены LLM-провайдера.
 */

const mocks = vi.hoisted(() => ({
  findById: vi.fn(),
  findMany: vi.fn(),
  managerScope: vi.fn((userId: string) => ({ managerScope: userId })),
  isVisibleTo: vi.fn(),
  findUniversityNames: vi.fn(async () => new Map<string, string>()),
  findUniversityDomains: vi.fn(async () => [] as Array<{ universityId: string; domains: string[] }>),
  findActiveCooperation: vi.fn(async () => null as { cooperationId: string; stageNumber: number | null } | null),
  findLabeledExamples: vi.fn(async () => [] as unknown[]),
  saveAnalysis: vi.fn(),
  saveReviewAndCreateTask: vi.fn(),
  findResponsible: vi.fn(async () => null as string | null),
  assertUniversityExists: vi.fn(async () => true),
  cooperationBelongsToUniversity: vi.fn(async () => true),
  dismiss: vi.fn(),
  saveReplyDraft: vi.fn(),
  findAllGroupStats: vi.fn(async () => [] as unknown[]),
  findGroupStats: vi.fn(async () => null),
  recordGroupEvent: vi.fn(),
  create: vi.fn(),
}))

vi.mock('./inbound-letters.repo', () => mocks)
vi.mock('@/shared/audit/audit', () => ({ writeAudit: vi.fn() }))
vi.mock('@/modules/ai-assist/ai-assist.repo', () => ({
  findRedactionContext: vi.fn(async () => ({ people: { staff: [], contacts: [] }, universityNames: [] as string[] })),
}))

const service = await import('./inbound-letters.service')

function user(role: UserRole, overrides: Partial<CurrentUser> = {}): CurrentUser {
  return { id: `u-${role}`, email: `${role.toLowerCase()}@test.local`, fullName: role, role, universityId: null, ...overrides }
}

function letterRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'letter-1',
    senderEmail: 'priemnaya@university.example.invalid',
    senderName: null,
    subject: 'Об этапе договора',
    bodyText: 'Просим сообщить, когда пройдёт встреча по проекту.',
    receivedAt: new Date('2026-09-20T10:00:00.000Z'),
    source: 'EML_UPLOAD' as const,
    messageId: null,
    status: 'ANALYZED' as InboundLetterStatus,
    universityId: 'uni-1',
    cooperationId: 'coop-1',
    stageNumber: 5,
    group: 'MEETING' as InboundLetterGroup,
    action: 'Согласовать время встречи',
    detectedUniversityId: 'uni-1',
    detectedCooperationId: 'coop-1',
    detectedStageNumber: 5,
    detectedGroup: 'MEETING' as InboundLetterGroup,
    detectedAction: 'Согласовать время встречи',
    confidence: 0.4,
    quotes: ['Просим сообщить, когда пройдёт встреча по проекту.'],
    analyzedBy: 'RULES' as const,
    analyzedNote: 'disabled',
    analyzedAt: new Date('2026-09-20T10:05:00.000Z'),
    reviewedById: null,
    reviewedAt: null,
    verdict: null,
    reviewComment: null,
    replyDraft: null,
    replyDraftSource: null,
    replyDraftUpdatedAt: null,
    isMock: false,
    createdAt: new Date('2026-09-20T10:00:00.000Z'),
    updatedAt: new Date('2026-09-20T10:05:00.000Z'),
    university: { name: 'СПбГУТ' },
    reviewedBy: null,
    task: null,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.managerScope.mockImplementation((userId: string) => ({ managerScope: userId }))
  mocks.assertUniversityExists.mockResolvedValue(true)
  mocks.cooperationBelongsToUniversity.mockResolvedValue(true)
  mocks.findUniversityNames.mockResolvedValue(new Map([['uni-1', 'СПбГУТ']]))
  mocks.findLabeledExamples.mockResolvedValue([])
  mocks.findUniversityDomains.mockResolvedValue([])
  mocks.findActiveCooperation.mockResolvedValue(null)
})

// ────────────────────────────────── Права ────────────────────────────────────

describe('права: чтение (решение 170)', () => {
  it.each(['ANALYST', 'VIEWER', 'UNIVERSITY_REP'] as const)('роль %s не видит обращения (нет INBOUND_READ)', async (role) => {
    await expectRejectCode(service.list(user(role), { page: 1, pageSize: 20 }), 'FORBIDDEN')
    await expectRejectCode(service.getById(user(role), 'letter-1'), 'FORBIDDEN')
  })

  it('MANAGER читает только свои — список идёт с managerScope(user.id)', async () => {
    mocks.findMany.mockResolvedValue({ rows: [], total: 0 })
    await service.list(user('MANAGER'), { page: 1, pageSize: 20 })
    expect(mocks.managerScope).toHaveBeenCalledWith('u-MANAGER')
    expect(mocks.findMany).toHaveBeenCalledWith(expect.anything(), { managerScope: 'u-MANAGER' })
  })

  it('ADMIN и HEAD видят все — без ограничения по ответственности', async () => {
    mocks.findMany.mockResolvedValue({ rows: [], total: 0 })
    await service.list(user('ADMIN'), { page: 1, pageSize: 20 })
    expect(mocks.managerScope).not.toHaveBeenCalled()
    expect(mocks.findMany).toHaveBeenCalledWith(expect.anything(), {})
  })

  it('MANAGER не видит письмо чужого вуза (isVisibleTo — false) — 404, не 403', async () => {
    mocks.findById.mockResolvedValue(letterRow())
    mocks.isVisibleTo.mockResolvedValue(false)
    await expectRejectCode(service.getById(user('MANAGER'), 'letter-1'), 'NOT_FOUND')
  })

  it('MANAGER видит письмо своего вуза', async () => {
    mocks.findById.mockResolvedValue(letterRow())
    mocks.isVisibleTo.mockResolvedValue(true)
    const dto = await service.getById(user('MANAGER'), 'letter-1')
    expect(dto.id).toBe('letter-1')
  })
})

describe('права: разбор и решения (решение 170)', () => {
  it.each(['MANAGER', 'ANALYST', 'VIEWER', 'UNIVERSITY_REP'] as const)('роль %s не может разбирать письма (нет INBOUND_REVIEW)', async (role) => {
    await expectRejectCode(service.analyzeLetter(user(role), 'letter-1'), 'FORBIDDEN')
    await expectRejectCode(service.review(user(role), 'letter-1', { verdict: 'CORRECT' }), 'FORBIDDEN')
    await expectRejectCode(service.dismissLetter(user(role), 'letter-1', {}), 'FORBIDDEN')
    await expectRejectCode(
      service.uploadEml(user(role), { name: 'l.eml', type: 'message/rfc822', size: 1, bytes: new Uint8Array() }),
      'FORBIDDEN',
    )
  })

  it('эксперту (isReviewer) недоступны разбор, проверка, отклонение и загрузка — тоже FORBIDDEN', async () => {
    const reviewer = user('ADMIN', { isReviewer: true })
    await expectRejectCode(service.analyzeLetter(reviewer, 'letter-1'), 'FORBIDDEN')
    await expectRejectCode(service.review(reviewer, 'letter-1', { verdict: 'CORRECT' }), 'FORBIDDEN')
    await expectRejectCode(service.dismissLetter(reviewer, 'letter-1', {}), 'FORBIDDEN')
    await expectRejectCode(
      service.uploadEml(reviewer, { name: 'l.eml', type: 'message/rfc822', size: 1, bytes: new Uint8Array() }),
      'FORBIDDEN',
    )
    // Чтение эксперту остаётся (список пуст без реальной базы, но прав хватает — не 403).
    mocks.findMany.mockResolvedValue({ rows: [], total: 0 })
    await expect(service.list(reviewer, { page: 1, pageSize: 20 })).resolves.toBeDefined()
  })

  it('ADMIN и HEAD могут разбирать и проверять письма', async () => {
    mocks.findById.mockResolvedValue(letterRow({ status: 'NEW' }))
    await expect(service.analyzeLetter(user('ADMIN'), 'letter-1')).resolves.toBeDefined()
    mocks.saveAnalysis.mockResolvedValue(undefined)
  })
})

// ──────────────────────────────── Проверка → задание ─────────────────────────

describe('review: «Верно»/«Неверно» → статус и задание (решение 170)', () => {
  it('«Верно» без найденного вуза — ошибка валидации, а не тихое подтверждение пустоты', async () => {
    mocks.findById.mockResolvedValue(letterRow({ universityId: null, group: null, action: null }))
    await expectRejectCode(service.review(user('ADMIN'), 'letter-1', { verdict: 'CORRECT' }), 'VALIDATION_ERROR')
  })

  it('«Верно» — статус CONFIRMED, задание по найденным вузу/связке, успех в статистику', async () => {
    mocks.findById.mockResolvedValue(letterRow())
    mocks.findResponsible.mockResolvedValue('manager-1')
    mocks.saveReviewAndCreateTask.mockResolvedValue(letterRow({ status: 'CONFIRMED', verdict: 'CORRECT' }))

    await service.review(user('ADMIN'), 'letter-1', { verdict: 'CORRECT' })

    expect(mocks.saveReviewAndCreateTask).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'CONFIRMED', verdict: 'CORRECT', universityId: 'uni-1', cooperationId: 'coop-1', group: 'MEETING' }),
      expect.objectContaining({ universityId: 'uni-1', cooperationId: 'coop-1', responsibleId: 'manager-1', group: 'MEETING' }),
    )
    // Разбор угадал группу (MEETING === MEETING) — успех засчитан.
    expect(mocks.recordGroupEvent).toHaveBeenCalledWith('MEETING', { trials: 1, successes: 1 }, expect.any(Date))
  })

  it('«Неверно» — требует существующий вуз, создаёт задание по указанным значениям, штрафует статистику разбора', async () => {
    mocks.findById.mockResolvedValue(letterRow())
    mocks.findResponsible.mockResolvedValue(null)
    mocks.saveReviewAndCreateTask.mockResolvedValue(letterRow({ status: 'CORRECTED', verdict: 'INCORRECT' }))

    await service.review(user('HEAD'), 'letter-1', {
      verdict: 'INCORRECT',
      universityId: 'uni-2',
      group: 'DOCUMENTS',
      action: 'Оформить документы',
      comment: 'Вуз определён неверно',
    })

    expect(mocks.saveReviewAndCreateTask).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'CORRECTED', verdict: 'INCORRECT', universityId: 'uni-2', group: 'DOCUMENTS' }),
      expect.objectContaining({ universityId: 'uni-2', group: 'DOCUMENTS', action: 'Оформить документы' }),
    )
    // Разбор предложил MEETING, сотрудник подтвердил DOCUMENTS — неудача разбора.
    expect(mocks.recordGroupEvent).toHaveBeenCalledWith('MEETING', { trials: 1, successes: 0 }, expect.any(Date))
  })

  it('несуществующий вуз в «Неверно» — ошибка валидации', async () => {
    mocks.findById.mockResolvedValue(letterRow())
    mocks.assertUniversityExists.mockResolvedValue(false)
    await expectRejectCode(
      service.review(user('ADMIN'), 'letter-1', {
        verdict: 'INCORRECT',
        universityId: 'ghost',
        group: 'DOCUMENTS',
        action: 'Что-то сделать',
        comment: 'Вуз не тот',
      }),
      'VALIDATION_ERROR',
    )
  })

  it('уже проверенное письмо — CONFLICT на повторную проверку, разбор и отклонение', async () => {
    mocks.findById.mockResolvedValue(letterRow({ status: 'CONFIRMED' }))
    await expectRejectCode(service.review(user('ADMIN'), 'letter-1', { verdict: 'CORRECT' }), 'CONFLICT')
    await expectRejectCode(service.dismissLetter(user('ADMIN'), 'letter-1', {}), 'CONFLICT')
    await expectRejectCode(service.analyzeLetter(user('ADMIN'), 'letter-1'), 'CONFLICT')
  })

  it('письмо не найдено — NOT_FOUND', async () => {
    mocks.findById.mockResolvedValue(null)
    await expectRejectCode(service.review(user('ADMIN'), 'missing', { verdict: 'CORRECT' }), 'NOT_FOUND')
    await expectRejectCode(service.getById(user('ADMIN'), 'missing'), 'NOT_FOUND')
  })
})

describe('отклонение как спам', () => {
  it('меняет статус на DISMISSED, задание не создаётся', async () => {
    mocks.findById.mockResolvedValue(letterRow({ status: 'NEW' }))
    mocks.dismiss.mockResolvedValue(letterRow({ status: 'DISMISSED' }))
    const dto = await service.dismissLetter(user('ADMIN'), 'letter-1', { comment: 'Рассылка' })
    expect(dto.status).toBe('DISMISSED')
    expect(mocks.saveReviewAndCreateTask).not.toHaveBeenCalled()
  })
})

describe('черновик ответа', () => {
  it('нельзя собрать черновик для неразобранного письма', async () => {
    mocks.findById.mockResolvedValue(letterRow({ status: 'NEW' }))
    await expectRejectCode(service.generateReplyDraft(user('ADMIN'), 'letter-1'), 'CONFLICT')
  })

  it('нельзя собрать черновик для отклонённого письма', async () => {
    mocks.findById.mockResolvedValue(letterRow({ status: 'DISMISSED' }))
    await expectRejectCode(service.generateReplyDraft(user('ADMIN'), 'letter-1'), 'CONFLICT')
  })

  it('без модели — шаблон, mailto ссылка собрана из адреса и темы', async () => {
    mocks.findById.mockResolvedValue(letterRow())
    mocks.saveReplyDraft.mockImplementation(async (_id, text, source, now) =>
      letterRow({ replyDraft: text, replyDraftSource: source, replyDraftUpdatedAt: now }),
    )
    const dto = await service.generateReplyDraft(user('ADMIN'), 'letter-1')
    expect(dto.replyDraft?.source).toBe('template')
    expect(dto.replyDraft?.mailto).toContain('mailto:priemnaya%40university.example.invalid')
    expect(dto.replyDraft?.mailto).toContain('subject=Re%3A')
  })

  it('правка черновика вручную помечается как template', async () => {
    mocks.findById.mockResolvedValue(letterRow())
    mocks.saveReplyDraft.mockImplementation(async (_id, text, source, now) =>
      letterRow({ replyDraft: text, replyDraftSource: source, replyDraftUpdatedAt: now }),
    )
    const dto = await service.updateReplyDraft(user('ADMIN'), 'letter-1', { text: 'Свой текст' })
    expect(dto.replyDraft?.text).toBe('Свой текст')
    expect(dto.replyDraft?.source).toBe('template')
  })
})

describe('статистика точности по группе', () => {
  it('без наблюдений — accuracy null, все шесть групп присутствуют', async () => {
    mocks.findAllGroupStats.mockResolvedValue([])
    const dto = await service.stats(user('ADMIN'))
    expect(dto.groups).toHaveLength(6)
    expect(dto.groups.every((g) => g.accuracy === null && g.totalReviewed === 0)).toBe(true)
  })

  it('с наблюдениями — totalReviewed/totalCorrect без забывания, accuracy с ним', async () => {
    mocks.findAllGroupStats.mockResolvedValue([
      { group: 'MEETING', trials: 4, successes: 3, trialsEff: 4, successesEff: 3, effUpdatedAt: new Date() },
    ])
    const dto = await service.stats(user('HEAD'))
    const meeting = dto.groups.find((g) => g.group === 'MEETING')!
    expect(meeting.totalReviewed).toBe(4)
    expect(meeting.totalCorrect).toBe(3)
    expect(meeting.accuracy).toBeCloseTo(0.75, 5)
  })
})
