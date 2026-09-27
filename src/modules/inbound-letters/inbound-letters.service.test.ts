import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
  findByMessageId: vi.fn(),
  findMany: vi.fn(),
  managerScope: vi.fn((userId: string) => ({ managerScope: userId })),
  isVisibleTo: vi.fn(),
  findUniversityNames: vi.fn(async () => new Map<string, string>()),
  findUniversityDomains: vi.fn(async () => [] as Array<{ universityId: string; domains: string[] }>),
  findActiveCooperation: vi.fn(async () => null as { cooperationId: string; stageNumber: number | null } | null),
  findCurrentStageNumber: vi.fn(async () => null as number | null),
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
  listNoticeRecipientIds: vi.fn(async () => [] as string[]),
  completeTask: vi.fn(),
}))

const notifyMocks = vi.hoisted(() => ({
  sendToUser: vi.fn(async () => ({ sent: false as const, channel: null })),
}))

vi.mock('./inbound-letters.repo', () => mocks)
const auditMocks = vi.hoisted(() => ({ writeAudit: vi.fn(), recordAuditOnce: vi.fn() }))
vi.mock('@/shared/audit/audit', () => auditMocks)
vi.mock('@/modules/ai-assist/ai-assist.repo', () => ({
  findRedactionContext: vi.fn(async () => ({ people: { staff: [], contacts: [] }, universityNames: [] as string[] })),
}))
vi.mock('@/modules/notify-channels/notify-channels.service', () => notifyMocks)

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
  mocks.findByMessageId.mockResolvedValue(null)
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

// ──────────────────────── Уведомление ADMIN/HEAD о новом письме (решение 183) ─────────────

const EML_CRLF = '\r\n'
function eml(headers: string[] = []): Uint8Array {
  return new TextEncoder().encode(
    [
      'From: "Иванова Мария" <maria@university.example.invalid>',
      'Subject: Вопрос по программе',
      'Content-Type: text/plain; charset=utf-8',
      ...headers,
    ].join(EML_CRLF) +
      EML_CRLF +
      EML_CRLF +
      'Уточните, пожалуйста, сроки начала занятий.',
  )
}

describe('uploadEml: уведомление ADMIN/HEAD о новом обращении (решение 183)', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('шлёт только название вуза и группу — без ФИО, почты и текста письма', async () => {
    // Адрес стенда в CI задан (AUTH_URL) — тогда появилась бы кнопка «Открыть»;
    // здесь проверяется вариант без адреса, поэтому окружение фиксируется явно.
    vi.stubEnv('AUTH_URL', '')
    vi.stubEnv('APP_BASE_URL', '')
    mocks.create.mockResolvedValue(letterRow({ status: 'NEW' }))
    mocks.findById.mockResolvedValue(letterRow({ status: 'NEW', group: 'MEETING' }))
    mocks.saveAnalysis.mockResolvedValue(undefined)
    mocks.listNoticeRecipientIds.mockResolvedValue(['admin-1', 'head-1'])

    await service.uploadEml(user('ADMIN'), { name: 'l.eml', type: 'message/rfc822', size: 1, bytes: eml() })

    expect(mocks.listNoticeRecipientIds).toHaveBeenCalledTimes(1)
    expect(notifyMocks.sendToUser).toHaveBeenCalledTimes(2)
    // Без адреса стенда кнопки «Открыть» нет, «Принял» — на это письмо (решение 200).
    const notice = {
      text: 'Новое письмо от вуза СПбГУТ: Встреча',
      actions: [[{ kind: 'accept', text: '✓ Принял, беру в работу', target: { type: 'letter', id: 'letter-1' } }]],
    }
    expect(notifyMocks.sendToUser).toHaveBeenCalledWith('admin-1', notice)
    expect(notifyMocks.sendToUser).toHaveBeenCalledWith('head-1', notice)
    const sent = JSON.stringify(notifyMocks.sendToUser.mock.calls)
    expect(sent).not.toMatch(/priemnaya|Просим сообщить|Об этапе договора/)
  })

  it('с адресом стенда — кнопка «Открыть письмо» ведёт на карточку письма', async () => {
    vi.stubEnv('AUTH_URL', 'https://skilllink.example.test/')
    try {
      mocks.create.mockResolvedValue(letterRow({ status: 'NEW' }))
      mocks.findById.mockResolvedValue(letterRow({ status: 'NEW', group: 'MEETING' }))
      mocks.saveAnalysis.mockResolvedValue(undefined)
      mocks.listNoticeRecipientIds.mockResolvedValue(['admin-1'])

      await service.uploadEml(user('ADMIN'), { name: 'l.eml', type: 'message/rfc822', size: 1, bytes: eml() })

      const message = (notifyMocks.sendToUser.mock.calls[0] as unknown[])[1] as { actions: unknown[][] }
      expect(message.actions[0]![0]).toEqual({
        kind: 'open',
        text: 'Открыть письмо',
        url: 'https://skilllink.example.test/letters/letter-1',
      })
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('сбой отправки не роняет загрузку письма', async () => {
    mocks.create.mockResolvedValue(letterRow({ status: 'NEW' }))
    mocks.findById.mockResolvedValue(letterRow({ status: 'NEW' }))
    mocks.saveAnalysis.mockResolvedValue(undefined)
    mocks.listNoticeRecipientIds.mockRejectedValue(new Error('база недоступна'))

    await expect(
      service.uploadEml(user('HEAD'), { name: 'l.eml', type: 'message/rfc822', size: 1, bytes: eml() }),
    ).resolves.toBeDefined()
  })
})

describe('uploadEml: повторная загрузка того же .eml (решение 187)', () => {
  it('тот же messageId и тот же отправитель уже загружены — конфликт, второе письмо не заводится', async () => {
    mocks.findByMessageId.mockResolvedValue(letterRow({ id: 'letter-existing' }))

    await expectRejectCode(
      service.uploadEml(user('ADMIN'), {
        name: 'l.eml',
        type: 'message/rfc822',
        size: 1,
        bytes: eml(['Message-ID: <abc123@university.example.invalid>']),
      }),
      'CONFLICT',
    )
    expect(mocks.findByMessageId).toHaveBeenCalledWith(
      'abc123@university.example.invalid',
      'maria@university.example.invalid',
    )
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('другой messageId — загружается как обычно', async () => {
    mocks.findByMessageId.mockResolvedValue(null)
    mocks.create.mockResolvedValue(letterRow({ status: 'NEW' }))
    mocks.findById.mockResolvedValue(letterRow({ status: 'NEW' }))
    mocks.saveAnalysis.mockResolvedValue(undefined)

    await expect(
      service.uploadEml(user('ADMIN'), {
        name: 'l.eml',
        type: 'message/rfc822',
        size: 1,
        bytes: eml(['Message-ID: <new-one@university.example.invalid>']),
      }),
    ).resolves.toBeDefined()
    expect(mocks.create).toHaveBeenCalledTimes(1)
  })

  it('в письме нет заголовка Message-ID — проверка на дубль не выполняется', async () => {
    mocks.create.mockResolvedValue(letterRow({ status: 'NEW' }))
    mocks.findById.mockResolvedValue(letterRow({ status: 'NEW' }))
    mocks.saveAnalysis.mockResolvedValue(undefined)

    await expect(
      service.uploadEml(user('ADMIN'), { name: 'l.eml', type: 'message/rfc822', size: 1, bytes: eml() }),
    ).resolves.toBeDefined()
    expect(mocks.findByMessageId).not.toHaveBeenCalled()
    expect(mocks.create).toHaveBeenCalledTimes(1)
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

  it('«Неверно» без указанной связки — этап берётся из активной связки вуза, как в обычном разборе (решение 187)', async () => {
    // До исправления stageNumber всегда становился null в «Неверно», даже когда
    // у указанного вуза есть активная связка с известным этапом — тот же вуз,
    // тот же findActiveCooperation, что и в analyzeLetter, просто не вызывался.
    mocks.findById.mockResolvedValue(letterRow())
    mocks.findResponsible.mockResolvedValue(null)
    mocks.findActiveCooperation.mockResolvedValue({ cooperationId: 'coop-2', stageNumber: 7 })
    mocks.saveReviewAndCreateTask.mockResolvedValue(letterRow({ status: 'CORRECTED', verdict: 'INCORRECT' }))

    await service.review(user('HEAD'), 'letter-1', {
      verdict: 'INCORRECT',
      universityId: 'uni-2',
      group: 'DOCUMENTS',
      action: 'Оформить документы',
      comment: 'Вуз определён неверно',
    })

    expect(mocks.findActiveCooperation).toHaveBeenCalledWith('uni-2')
    expect(mocks.saveReviewAndCreateTask).toHaveBeenCalledWith(
      expect.objectContaining({ cooperationId: 'coop-2', stageNumber: 7 }),
      expect.anything(),
    )
  })

  it('«Неверно» со связкой, указанной сотрудником, совпадающей с активной — этап той же связки', async () => {
    mocks.findById.mockResolvedValue(letterRow())
    mocks.findResponsible.mockResolvedValue(null)
    mocks.cooperationBelongsToUniversity.mockResolvedValue(true)
    mocks.findActiveCooperation.mockResolvedValue({ cooperationId: 'coop-2', stageNumber: 7 })
    mocks.saveReviewAndCreateTask.mockResolvedValue(letterRow({ status: 'CORRECTED', verdict: 'INCORRECT' }))

    await service.review(user('HEAD'), 'letter-1', {
      verdict: 'INCORRECT',
      universityId: 'uni-2',
      cooperationId: 'coop-2',
      group: 'DOCUMENTS',
      action: 'Оформить документы',
      comment: 'Вуз определён неверно',
    })

    expect(mocks.saveReviewAndCreateTask).toHaveBeenCalledWith(
      expect.objectContaining({ cooperationId: 'coop-2', stageNumber: 7 }),
      expect.anything(),
    )
  })

  it('«Неверно» со связкой, указанной сотрудником, отличной от активной — текущий этап именно этой связки (решение 210)', async () => {
    mocks.findById.mockResolvedValue(letterRow())
    mocks.findResponsible.mockResolvedValue(null)
    mocks.cooperationBelongsToUniversity.mockResolvedValue(true)
    // Система считает активной coop-2 (этап 7), но сотрудник выбрал другую связку того же вуза:
    // этап 7 ей не приписывается — берётся её собственный текущий этап.
    mocks.findActiveCooperation.mockResolvedValue({ cooperationId: 'coop-2', stageNumber: 7 })
    mocks.findCurrentStageNumber.mockResolvedValue(2)
    mocks.saveReviewAndCreateTask.mockResolvedValue(letterRow({ status: 'CORRECTED', verdict: 'INCORRECT' }))

    await service.review(user('HEAD'), 'letter-1', {
      verdict: 'INCORRECT',
      universityId: 'uni-2',
      cooperationId: 'coop-3',
      group: 'DOCUMENTS',
      action: 'Оформить документы',
      comment: 'Вуз определён неверно',
    })

    expect(mocks.findCurrentStageNumber).toHaveBeenCalledWith('coop-3')
    expect(mocks.saveReviewAndCreateTask).toHaveBeenCalledWith(
      expect.objectContaining({ cooperationId: 'coop-3', stageNumber: 2 }),
      expect.anything(),
    )
  })

  it('«Неверно» с одной сменой группы — связка и этап письма на месте (решение 210, S9)', async () => {
    // Стенд: у вуза несколько связок, «активной» система считала другую, и этап
    // письма (6) обнулялся, хотя сотрудник исправил только группу.
    mocks.findById.mockResolvedValue(letterRow({ cooperationId: 'coop-1', stageNumber: 6 }))
    mocks.findResponsible.mockResolvedValue(null)
    mocks.findActiveCooperation.mockResolvedValue({ cooperationId: 'coop-2', stageNumber: 7 })
    mocks.saveReviewAndCreateTask.mockResolvedValue(letterRow({ status: 'CORRECTED', verdict: 'INCORRECT' }))

    await service.review(user('HEAD'), 'letter-1', {
      verdict: 'INCORRECT',
      universityId: 'uni-1',
      cooperationId: 'coop-1',
      group: 'QUESTION',
      action: 'Ответить на вопрос вуза',
      comment: 'Это вопрос, а не встреча',
    })

    expect(mocks.findCurrentStageNumber).not.toHaveBeenCalled()
    expect(mocks.saveReviewAndCreateTask).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'CORRECTED', cooperationId: 'coop-1', stageNumber: 6, group: 'QUESTION' }),
      expect.anything(),
    )
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

// ──────────────────────── «Задание выполнено» (решение 183) ──────────────────

function letterWithTask(taskOverrides: Record<string, unknown> = {}, letterOverrides: Record<string, unknown> = {}) {
  return letterRow({
    task: {
      id: 'task-1',
      responsibleId: 'manager-1',
      status: 'OPEN',
      title: 'Письмо вуза: Встреча',
      createdAt: new Date('2026-09-20T10:10:00.000Z'),
      responsible: { fullName: 'Петров Пётр Петрович' },
      ...taskOverrides,
    },
    ...letterOverrides,
  })
}

describe('completeTask: «Задание выполнено» — ответственный или ADMIN/HEAD (решение 183)', () => {
  it('письмо не найдено — NOT_FOUND', async () => {
    mocks.findById.mockResolvedValue(null)
    await expectRejectCode(service.completeTask(user('ADMIN'), 'missing'), 'NOT_FOUND')
  })

  it('у письма нет задания — NOT_FOUND', async () => {
    mocks.findById.mockResolvedValue(letterRow({ task: null }))
    await expectRejectCode(service.completeTask(user('ADMIN'), 'letter-1'), 'NOT_FOUND')
  })

  it('уже выполнено — CONFLICT', async () => {
    mocks.findById.mockResolvedValue(letterWithTask({ status: 'DONE' }))
    await expectRejectCode(service.completeTask(user('ADMIN'), 'letter-1'), 'CONFLICT')
  })

  it('MANAGER, не ответственный за это задание — FORBIDDEN', async () => {
    mocks.findById.mockResolvedValue(letterWithTask({ responsibleId: 'manager-2' }))
    mocks.isVisibleTo.mockResolvedValue(true)
    await expectRejectCode(service.completeTask(user('MANAGER', { id: 'manager-1' }), 'letter-1'), 'FORBIDDEN')
  })

  it('MANAGER — ответственный за задание — отмечает выполненным', async () => {
    mocks.findById.mockResolvedValue(letterWithTask({ responsibleId: 'manager-1' }))
    mocks.isVisibleTo.mockResolvedValue(true)
    mocks.completeTask.mockResolvedValue(letterWithTask({ responsibleId: 'manager-1', status: 'DONE' }))

    const dto = await service.completeTask(user('MANAGER', { id: 'manager-1' }), 'letter-1')

    expect(mocks.completeTask).toHaveBeenCalledWith('letter-1', expect.any(Date))
    expect(dto.task?.status).toBe('DONE')
  })

  it('ADMIN и HEAD отмечают выполненным чужое задание', async () => {
    mocks.findById.mockResolvedValue(letterWithTask({ responsibleId: 'manager-1' }))
    mocks.completeTask.mockResolvedValue(letterWithTask({ responsibleId: 'manager-1', status: 'DONE' }))

    for (const role of ['ADMIN', 'HEAD'] as const) {
      const dto = await service.completeTask(user(role, { id: 'someone-else' }), 'letter-1')
      expect(dto.task?.status).toBe('DONE')
    }
  })

  it('задание без ответственного (null) — доступно только ADMIN/HEAD', async () => {
    mocks.findById.mockResolvedValue(letterWithTask({ responsibleId: null }))
    await expectRejectCode(service.completeTask(user('MANAGER'), 'letter-1'), 'FORBIDDEN')

    mocks.completeTask.mockResolvedValue(letterWithTask({ responsibleId: null, status: 'DONE' }))
    const dto = await service.completeTask(user('ADMIN'), 'letter-1')
    expect(dto.task?.status).toBe('DONE')
  })
})

describe('acceptLetter: «Принял, беру в работу» кнопкой в Telegram (решение 200)', () => {
  beforeEach(() => {
    auditMocks.recordAuditOnce.mockReset()
    mocks.findById.mockReset()
  })

  it('ADMIN/HEAD — отметка в журнал один раз, письмо не меняется', async () => {
    const at = new Date('2026-09-28T11:05:00.000Z')
    mocks.findById.mockResolvedValue(letterRow({ status: 'ANALYZED' }))
    auditMocks.recordAuditOnce.mockResolvedValue({ created: true, at })

    const now = new Date('2026-09-28T11:05:00.000Z')
    const result = await service.acceptLetter(user('HEAD'), 'letter-1', { source: 'telegram', now })

    expect(result).toEqual({ acceptedAt: at, alreadyAccepted: false, label: null })
    const [entry, since] = auditMocks.recordAuditOnce.mock.calls[0]! as [Record<string, unknown>, Date]
    expect(entry).toEqual({
      userId: 'u-HEAD',
      action: 'inbound_letter.accept',
      objectType: 'InboundLetter',
      objectId: 'letter-1',
      payload: { source: 'telegram' },
    })
    expect(since.getTime()).toBe(now.getTime() - 7 * 24 * 60 * 60_000)
    expect(mocks.saveAnalysis).not.toHaveBeenCalled()
  })

  it('повторное нажатие — та же отметка, alreadyAccepted', async () => {
    const at = new Date('2026-09-28T09:00:00.000Z')
    mocks.findById.mockResolvedValue(letterRow({ status: 'NEW' }))
    auditMocks.recordAuditOnce.mockResolvedValue({ created: false, at })
    expect(await service.acceptLetter(user('ADMIN'), 'letter-1', { source: 'telegram' })).toMatchObject({
      acceptedAt: at,
      alreadyAccepted: true,
    })
  })

  it('эксперт (даже ADMIN), менеджер и наблюдатель — 403, в журнал ничего', async () => {
    mocks.findById.mockResolvedValue(letterRow({ status: 'NEW' }))
    await expectRejectCode(service.acceptLetter(user('ADMIN', { isReviewer: true }), 'letter-1', { source: 'telegram' }), 'FORBIDDEN')
    await expectRejectCode(service.acceptLetter(user('MANAGER'), 'letter-1', { source: 'telegram' }), 'FORBIDDEN')
    await expectRejectCode(service.acceptLetter(user('VIEWER'), 'letter-1', { source: 'telegram' }), 'FORBIDDEN')
    expect(auditMocks.recordAuditOnce).not.toHaveBeenCalled()
  })

  it('письмо уже проверено — 409, нет письма — 404', async () => {
    mocks.findById.mockResolvedValueOnce(letterRow({ status: 'CONFIRMED' }))
    await expectRejectCode(service.acceptLetter(user('ADMIN'), 'letter-1', { source: 'telegram' }), 'CONFLICT')
    mocks.findById.mockResolvedValueOnce(null)
    await expectRejectCode(service.acceptLetter(user('ADMIN'), 'nope', { source: 'telegram' }), 'NOT_FOUND')
    expect(auditMocks.recordAuditOnce).not.toHaveBeenCalled()
  })
})
