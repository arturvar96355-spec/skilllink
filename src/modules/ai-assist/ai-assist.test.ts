import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AI_ASSIST_LIMITS } from '@/shared/config/ai-assist.config'
import { WORKFLOW_STAGES } from '@/shared/config/workflow.config'
import { aiDraftSourceNote } from '@/shared/contracts/ai-assist'
import type { CooperationDto } from '@/shared/contracts/cooperation'
import type { UserRole } from '@/shared/contracts/enums'
import type { RecommendationDto } from '@/shared/contracts/recommendation'
import type { WorkflowStageDto } from '@/shared/contracts/workflow'
import type { CurrentUser } from '@/shared/auth/current-user'
import { notFound } from '@/shared/http/errors'
import {
  DisabledLlmProvider,
  LlmError,
  type LlmCompletion,
  type LlmProvider,
  type LlmRequest,
} from '@/integrations/llm'
import { resetRateLimiter } from '@/integrations/http-client'
import { createRedactor } from './ai-assist.privacy'
import { buildLetterPrompt, buildSummaryPrompt, buildTodayPrompt, type AiPrompt } from './ai-assist.prompts'
import { generationsLeft, resetAiAssistLimits, takeGeneration } from './ai-assist.limits'
import {
  cleanModelText,
  letterFacts,
  summaryFacts,
  summaryTemplate,
  todayItems,
  type ProblemStageInput,
} from './ai-assist.rules'

/**
 * ИИ-помощник (решение 90). Сети здесь нет: провайдер модели подменён,
 * сервисы и база — тоже. Проверяется главное: персональные данные в модель
 * не уходят, сбой модели даёт шаблон, а не ошибку, лимит и права соблюдаются.
 */

const mocks = vi.hoisted(() => ({
  getCooperation: vi.fn(),
  listRecommendations: vi.fn(),
  getRecommendation: vi.fn(),
  toRecommendationDtos: vi.fn(),
  findRedactionContext: vi.fn(),
  findProgramLabel: vi.fn(),
  findOpenRecommendationsOf: vi.fn(),
  findGeneralRecommendations: vi.fn(),
  findProblemStagesOf: vi.fn(),
  writeAudit: vi.fn(),
  getLlmProvider: vi.fn(),
}))

vi.mock('@/modules/cooperation/cooperation.service', () => ({ getById: mocks.getCooperation }))
vi.mock('@/modules/recommendations/recommendations.service', () => ({
  list: mocks.listRecommendations,
  getById: mocks.getRecommendation,
  toRecommendationDtos: mocks.toRecommendationDtos,
}))
vi.mock('./ai-assist.repo', () => ({
  findRedactionContext: mocks.findRedactionContext,
  findProgramLabel: mocks.findProgramLabel,
  findOpenRecommendationsOf: mocks.findOpenRecommendationsOf,
  findGeneralRecommendations: mocks.findGeneralRecommendations,
  findProblemStagesOf: mocks.findProblemStagesOf,
}))
vi.mock('@/shared/audit/audit', () => ({ writeAudit: mocks.writeAudit }))
vi.mock('@/integrations/llm', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/integrations/llm')>()
  return { ...original, getLlmProvider: mocks.getLlmProvider }
})

const { compose, draftRecommendationLetter, summarizeCooperation, todayPlan } = await import(
  './ai-assist.service'
)
const realLlm = await vi.importActual<typeof import('@/integrations/llm')>('@/integrations/llm')

// ─────────────────────────── Данные для тестов ──────────────────────────────

const NOW = new Date('2026-09-25T09:00:00.000Z')
const UNIVERSITY = 'Санкт-Петербургский государственный университет телекоммуникаций'

/**
 * Персональные данные демо-набора — прямо из prisma/seed.ts: появится новый
 * демо-пользователь или контакт — тест проверит и его.
 */
const SEED = readFileSync(join(process.cwd(), 'prisma/seed.ts'), 'utf8')
const SEED_NAMES = [...SEED.matchAll(/fullName: '([^']+)'/g)].map((match) => match[1]!)
const SEED_EMAILS = [
  ...[...SEED.matchAll(/email: '([^']+)'/g)].map((match) => match[1]!),
  // Почта контактов в сиде собирается шаблоном: `contact@${item.key}.example.invalid`.
  'contact@spbgut.example.invalid',
]
const SEED_PHONES = [...SEED.matchAll(/phone: '([^']+)'/g)].map((match) => match[1]!)

const SEED_PEOPLE = {
  staff: SEED_NAMES.filter((name) => name !== 'Ветрова Ирина Павловна'),
  contacts: SEED_NAMES,
}

function initialsOf(fullName: string): string {
  const [surname, ...rest] = fullName.split(' ')
  return `${surname} ${rest.map((part) => `${part.charAt(0)}.`).join(' ')}`
}

/** Текст, в котором есть все люди демо-набора, их почта и телефоны — в разных формах. */
const PERSONAL_TEXT = [
  ...SEED_NAMES.map((name) => `${name}; ${initialsOf(name)}`),
  ...SEED_EMAILS,
  ...SEED_PHONES,
  '8 (812) 555-12-34',
].join(', ')

function assertNoPersonalData(text: string): void {
  for (const name of SEED_NAMES) {
    expect(text, name).not.toContain(name)
    const [surname, first, patronymic] = name.split(' ')
    expect(text, surname).not.toContain(surname!)
    if (patronymic) expect(text, `${first} ${patronymic}`).not.toContain(`${first} ${patronymic}`)
  }
  for (const email of SEED_EMAILS) expect(text, email).not.toContain(email)
  expect(text).not.toMatch(/@/)
  const digits = text.replace(/\D/g, '')
  expect(digits).not.toContain('79000000000')
  expect(digits).not.toContain('88125551234')
}

function stage(number: number, overrides: Partial<WorkflowStageDto> = {}): WorkflowStageDto {
  const definition = WORKFLOW_STAGES[number - 1]!
  return {
    id: `stage-${number}`,
    cooperationId: 'coop-1',
    stageNumber: number,
    title: definition.title,
    phase: definition.phase,
    status: 'NOT_STARTED',
    responsible: { id: 'u-manager2', fullName: 'Савельева Ольга Дмитриевна', role: 'MANAGER' },
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
    isAutoManaged: number === 14,
    tasks: [],
    requiredTasksTotal: 0,
    requiredTasksDone: 0,
    updatedAt: NOW.toISOString(),
    ...overrides,
  }
}

/**
 * Связка как в демо: СПбГУТ — Программная инженерия. Этапы 1–5 закрыты, этап 6
 * (контрольная точка) просрочен на 57 дней, 7–10 не начаты и просрочены, но заперты
 * точкой 6 — в проблемы они идти не должны.
 */
function cooperationFixture(overrides: { stages?: WorkflowStageDto[] } = {}): CooperationDto {
  const stages =
    overrides.stages ??
    Array.from({ length: 14 }, (_, index) => {
      const number = index + 1
      if (number <= 5) return stage(number, { status: 'COMPLETED' })
      if (number === 6) {
        return stage(6, {
          status: 'IN_PROGRESS',
          deadline: '2026-07-30T09:00:00.000Z',
          isOverdue: true,
          daysToDeadline: -57,
        })
      }
      if (number <= 10) {
        return stage(number, { deadline: '2026-08-13T09:00:00.000Z', isOverdue: true, daysToDeadline: -43 })
      }
      if (number === 14) return stage(14, { status: 'IN_PROGRESS' })
      return stage(number, { deadline: '2026-11-24T09:00:00.000Z', daysToDeadline: 60 })
    })
  return {
    id: 'coop-1',
    universityId: 'uni-spbgut',
    universityName: UNIVERSITY,
    universityShortName: 'СПбГУТ',
    programId: 'program-1',
    programName: 'Программная инженерия',
    productId: 'product-1',
    productName: 'Конвейер сборки и поставки',
    status: 'ACTIVE',
    responsible: { id: 'u-manager2', fullName: 'Савельева Ольга Дмитриевна', role: 'MANAGER' },
    currentStage: {
      id: 'stage-6',
      stageNumber: 6,
      title: 'Подписание документов',
      phase: 'FORMALIZATION',
      status: 'IN_PROGRESS',
      deadline: '2026-07-30T09:00:00.000Z',
      isOverdue: true,
      isPlanShifted: false,
      isDueSoon: false,
      daysToDeadline: -57,
    },
    progress: {
      percent: 38,
      completedStages: 5,
      cancelledStages: 0,
      totalStages: 13,
      overdueStages: 5,
      dueSoonStages: 0,
      blockedStages: 0,
    },
    targetDate: null,
    classesStartAt: '2026-12-09T09:00:00.000Z',
    daysToTarget: 75,
    isMock: true,
    updatedAt: NOW.toISOString(),
    goal: null,
    notes: null,
    firstContactAt: null,
    startedAt: null,
    closedAt: null,
    createdAt: NOW.toISOString(),
    stages,
  }
}

function recommendation(overrides: Partial<RecommendationDto> = {}): RecommendationDto {
  return {
    id: 'rec-overdue',
    type: 'ACTION',
    ruleKey: 'stage.overdue',
    title: 'Просрочен этап 6: Подписание документов',
    description:
      'Свяжитесь с ответственным и закройте этап либо перенесите срок с комментарием. ' +
      `Вуз: ${UNIVERSITY}, программа: Программная инженерия.`,
    priority: 'CRITICAL',
    justification:
      'Нормативный срок этапа прошёл 57 дн. назад, этап всё ещё в статусе «В работе». ' +
      'Ответственный: Савельева Ольга Дмитриевна.',
    relatedData: { stageNumber: 6, daysOverdue: 57, deadline: '2026-07-30T09:00:00.000Z', status: 'IN_PROGRESS' },
    confidence: 'HIGH',
    status: 'NEW',
    resolutionComment: null,
    target: { objectType: 'Cooperation', objectId: 'coop-1', label: 'СПбГУТ — Программная инженерия' },
    cooperationId: 'coop-1',
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    resolvedAt: null,
    score: null,
    scoreBreakdown: null,
    reasons: [],
    isDeferred: false,
    ...overrides,
  }
}

const redactor = () => createRedactor(SEED_PEOPLE, [UNIVERSITY, 'СПбГУТ'])

const as = (role: UserRole): CurrentUser => ({
  id: `user-${role}`,
  email: `${role.toLowerCase()}@skilllink.demo`,
  fullName: 'Текущий Пользователь',
  role,
  universityId: role === 'UNIVERSITY_REP' ? 'uni-spbgut' : null,
})

/** Модель-заглушка: записывает, что ей прислали, и отвечает из теста. */
function fakeProvider(
  answer: (request: LlmRequest) => Promise<LlmCompletion>,
  options: { kind?: 'yandexgpt' | 'gigachat'; ready?: boolean } = {},
) {
  const requests: LlmRequest[] = []
  const provider: LlmProvider = {
    info: () => ({
      kind: options.kind ?? 'yandexgpt',
      name: 'YandexGPT',
      ready: options.ready ?? true,
      reason: null,
      model: 'yandexgpt-lite',
    }),
    generate: vi.fn(async (request: LlmRequest) => {
      requests.push(request)
      return answer(request)
    }),
  }
  return { provider, requests }
}

const answering = (text: string) => async () => ({ text, model: 'yandexgpt-lite' })

function simplePrompt(user = 'Факты', overrides: Partial<AiPrompt> = {}): AiPrompt {
  return {
    kind: 'cooperation-summary',
    system: 'Инструкция',
    user,
    facts: ['Факт'],
    template: 'Шаблонный текст',
    accepts: (text) => text.length > 0,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  resetAiAssistLimits()
  resetRateLimiter()
  mocks.getLlmProvider.mockImplementation(() => new DisabledLlmProvider())
  mocks.findRedactionContext.mockResolvedValue({ people: SEED_PEOPLE, universityNames: [UNIVERSITY, 'СПбГУТ'] })
  mocks.getCooperation.mockResolvedValue(cooperationFixture())
  mocks.listRecommendations.mockResolvedValue({ data: [recommendation()], meta: { page: 1, pageSize: 20, total: 1 } })
  mocks.getRecommendation.mockResolvedValue(recommendation())
  mocks.toRecommendationDtos.mockImplementation(async (rows: RecommendationDto[]) => rows)
  mocks.findOpenRecommendationsOf.mockResolvedValue([recommendation()])
  mocks.findGeneralRecommendations.mockResolvedValue([])
  mocks.findProblemStagesOf.mockResolvedValue([])
  mocks.findProgramLabel.mockResolvedValue(null)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

// ─────────────────────────── Персональные данные ────────────────────────────

describe('персональные данные в модель не уходят', () => {
  it('в демо-наборе есть кого искать — иначе проверка ничего не проверяет', () => {
    expect(SEED_NAMES.length).toBeGreaterThanOrEqual(10)
    expect(SEED_EMAILS.length).toBeGreaterThanOrEqual(6)
    expect(SEED_PHONES.length).toBeGreaterThan(0)
  })

  it('сводка: ни ФИО, ни почты, ни телефонов — ни в промпте, ни в шаблоне', () => {
    const blocked = stage(6, {
      status: 'BLOCKED',
      blockingReason: `Ждём ответа: ${PERSONAL_TEXT}`,
      deadline: '2026-07-30T09:00:00.000Z',
      isOverdue: true,
      daysToDeadline: -57,
    })
    const cooperation = cooperationFixture()
    cooperation.stages[5] = blocked
    const recommendations = [
      recommendation(),
      recommendation({ id: 'rec-2', description: `Позвоните: ${PERSONAL_TEXT}.`, title: `Звонок ${SEED_NAMES[0]}` }),
    ]

    const prompt = buildSummaryPrompt(summaryFacts(cooperation, recommendations, NOW), redactor())
    for (const text of [prompt.system, prompt.user, prompt.template, ...prompt.facts]) {
      assertNoPersonalData(text)
    }
    // Названия и числа при этом на месте: без них сводка бессмысленна.
    expect(prompt.user).toContain(UNIVERSITY)
    expect(prompt.user).toContain('Подписание документов')
    expect(prompt.user).toContain('30.07.2026')
    expect(prompt.user).toContain('57 дней')
  })

  it('письмо: обоснование с ФИО ответственного не просачивается', () => {
    const prompt = buildLetterPrompt(
      letterFacts(
        recommendation({ ruleKey: 'custom.rule', justification: PERSONAL_TEXT, description: PERSONAL_TEXT }),
        { cooperation: cooperationFixture(), program: null },
      ),
      redactor(),
    )
    for (const text of [prompt.system, prompt.user, prompt.template, ...prompt.facts]) {
      assertNoPersonalData(text)
    }
  })

  it('дела на сегодня: причина блокировки с контактами вычищена', () => {
    const items = todayItems({
      own: [recommendation()],
      stages: [
        {
          cooperationId: 'coop-2',
          universityId: 'uni-mtuci',
          universityName: 'Московский технический университет связи и информатики',
          universityShortName: 'МТУСИ',
          programName: 'Облачные технологии и инфраструктура',
          stageNumber: 7,
          title: 'Передача учебных материалов, лицензии и документации',
          status: 'BLOCKED',
          deadline: new Date('2026-12-01T09:00:00.000Z'),
          blockingReason: PERSONAL_TEXT,
          siblings: [],
        },
      ],
      general: [],
      now: NOW,
    })
    const prompt = buildTodayPrompt(items, redactor())
    for (const text of [prompt.system, prompt.user, prompt.template, ...prompt.facts]) {
      assertNoPersonalData(text)
    }
  })

  it('«Ответственный: …» вырезается, фамилия в падеже и с инициалами заменяется', () => {
    const redact = redactor()
    expect(redact('Этап просрочен. Ответственный: Кириллов Пётр Андреевич.')).toBe('Этап просрочен.')
    expect(redact('Этап просрочен. Ответственный: Кириллов П. А.')).toBe('Этап просрочен.')
    // Человека нет в базе — фраза всё равно вырезается, следующее предложение остаётся.
    expect(redact('Ответственный: Иванов Иван Иванович. Срок прошёл.')).toBe('Срок прошёл.')
    expect(redact('Ответственный: не назначен.')).toBe('Ответственный: не назначен.')
    expect(redact('Передали Кириллову П. А. и Савельевой')).toBe('Передали ответственный и ответственный')
    expect(redact('Ждём Ветрову Ирину Павловну')).toBe('Ждём представитель вуза')
    expect(redact('Согласовать с Иванов И. И.')).toBe('Согласовать с ответственный')
  })

  it('даты и числа не принимаются за телефон, телефоны и почта — да', () => {
    const redact = redactor()
    expect(redact('Срок 30.07.2026, прошло 57 дн., 5 из 13')).toBe('Срок 30.07.2026, прошло 57 дн., 5 из 13')
    expect(redact('Звонить +7 (900) 000-00-00 или 8 812 555 12 34')).toBe(
      'Звонить [телефон скрыт] или [телефон скрыт]',
    )
    expect(redact('Писать rep@spbgu.example.invalid')).toBe('Писать [адрес скрыт]')
  })

  it('официальное название с инициалами не режется', () => {
    const name = 'Университет телекоммуникаций им. проф. М. А. Бонч-Бруевича'
    const redact = createRedactor(SEED_PEOPLE, [name])
    expect(redact(`Вуз: ${name}, звонил Иванов И. И.`)).toBe(`Вуз: ${name}, звонил ответственный`)
  })
})

// ─────────────────────────── Факты и шаблоны ────────────────────────────────

describe('сводка по связке', () => {
  it('факты — из карточки связки: текущий этап, прогресс, проблемы без запертых этапов', () => {
    const facts = summaryFacts(cooperationFixture(), [recommendation()], NOW)
    expect(facts.currentStage).toMatchObject({ number: 6, daysOverdue: 57 })
    expect(facts.closedStages).toBe(5)
    expect(facts.totalStages).toBe(13)
    // Этапы 7–10 просрочены, но заперты контрольной точкой 6 — их не начать.
    expect(facts.problemStages.map((item) => item.number)).toEqual([6])
    expect(facts.recommendations[0]).toMatchObject({
      priority: 'CRITICAL',
      action: 'Свяжитесь с ответственным и закройте этап либо перенесите срок с комментарием.',
    })
    expect(facts.daysToClasses).toBe(75)
  })

  it('шаблон — 3–5 предложений: где связка, что мешает, что дальше, когда занятия', () => {
    const text = summaryTemplate(summaryFacts(cooperationFixture(), [recommendation()], NOW))
    expect(text).toContain('на этапе 6 «Подписание документов»')
    expect(text).toContain('пройдено 5 из 13')
    expect(text).toContain('просрочен на 57 дней')
    expect(text).toContain('свяжитесь с ответственным')
    expect(text).toContain('09.12.2026, через 75 дней')
    const sentences = text.split(/(?<=[.!?])\s+(?=[А-ЯЁ])/)
    expect(sentences.length).toBeGreaterThanOrEqual(3)
    expect(sentences.length).toBeLessThanOrEqual(5)
  })

  it('без проблем и рекомендаций шаблон так и говорит', () => {
    const calm = cooperationFixture({
      stages: [stage(1, { status: 'IN_PROGRESS' }), stage(14, { status: 'IN_PROGRESS' })],
    })
    calm.currentStage = { ...calm.currentStage!, id: 'stage-1', stageNumber: 1, isOverdue: false }
    const text = summaryTemplate(summaryFacts(calm, [], NOW))
    expect(text).toContain('Просрочек и блокировок нет.')
    expect(text).toContain('Дальше — продолжить этап 1 «Поиск контакта ответственного лица в вузе».')
  })
})

describe('письмо вузу', () => {
  it('по просрочке: тема, что нужно от вуза и плановый срок — из данных правила', () => {
    const prompt = buildLetterPrompt(
      letterFacts(recommendation(), { cooperation: cooperationFixture(), program: null }),
      redactor(),
    )
    expect(prompt.template).toMatch(/^Тема: Этап «Подписание документов» по программе «Программная инженерия»/)
    expect(prompt.template).toContain('Уважаемые коллеги!')
    expect(prompt.template).toContain('не завершён, плановый срок был 30.07.2026, прошло 57 дней.')
    expect(prompt.template.match(/30\.07\.2026/g)).toHaveLength(1)
    expect(prompt.template).toContain('согласовать новую дату завершения')
    expect(prompt.template.trimEnd().endsWith('С уважением,\nИТ-Школа РТК')).toBe(true)
    expect(prompt.facts).toContain('Срок: плановый срок этапа — 30.07.2026')
  })

  it('без срока в данных дату не называет и запрещает её модели', () => {
    const prompt = buildLetterPrompt(
      letterFacts(
        recommendation({
          ruleKey: 'program.missing-metrics',
          relatedData: { programId: 'program-1', missing: ['applicationCount', 'groupCount'] },
          target: { objectType: 'EducationalProgram', objectId: 'program-1', label: 'Программная инженерия · СПбГУТ' },
          cooperationId: null,
        }),
        {
          cooperation: null,
          program: { name: 'Программная инженерия', universityName: UNIVERSITY, universityShortName: 'СПбГУТ' },
        },
      ),
      redactor(),
    )
    expect(prompt.template).toContain('заявки на обучение, количество параллельных групп')
    expect(prompt.template).not.toMatch(/\d{2}\.\d{2}\.\d{4}/)
    expect(prompt.facts).toContain('Срок: в данных не указан, дату не называть')
    expect(prompt.system).toContain('Если срока нет — не называй никакой даты')
  })

  it('по дефициту навыка предлагает продукт из данных правила', () => {
    const facts = letterFacts(
      recommendation({
        ruleKey: 'skill.critical-gap-with-product',
        title: 'Дефицит навыка «Kubernetes» закрывается нашим продуктом',
        relatedData: { products: [{ id: 'p', name: 'Облачная платформа РТК', relevance: 'CORE' }] },
        target: { objectType: 'Skill', objectId: 'skill-1', label: 'Навык «Kubernetes»' },
        cooperationId: null,
      }),
      { cooperation: null, program: null },
    )
    expect(facts.request).toContain('«Облачная платформа РТК»')
    expect(facts.subject).toContain('«Kubernetes»')
    expect(facts.deadline).toBeNull()
  })
})

describe('дела на сегодня', () => {
  const blockedStage: ProblemStageInput = {
    cooperationId: 'coop-2',
    universityId: 'uni-mtuci',
    universityName: 'Московский технический университет связи и информатики',
    universityShortName: 'МТУСИ',
    programName: 'Облачные технологии и инфраструктура',
    stageNumber: 7,
    title: 'Передача учебных материалов, лицензии и документации',
    status: 'BLOCKED',
    deadline: new Date('2026-12-01T09:00:00.000Z'),
    blockingReason: 'Вуз не подтвердил получение лицензии',
    siblings: [],
  }

  it('порядок — по правилам: важность, затем вид правила; дубль просрочки не повторяется', () => {
    const stalled = recommendation({
      id: 'rec-stalled',
      ruleKey: 'cooperation.stalled',
      title: 'Связка без движения 46 дн.',
      description: 'Начните этап 6 «Подписание документов» или зафиксируйте причину паузы.',
      priority: 'MEDIUM',
      justification: 'Движения не было 46 дн.',
      relatedData: { stageNumber: 6, idleDays: 46 },
      cooperationId: 'coop-3',
    })
    const items = todayItems({
      own: [stalled, recommendation()],
      stages: [
        blockedStage,
        // Тот же этап, что у рекомендации о просрочке, — второй раз не идёт.
        { ...blockedStage, cooperationId: 'coop-1', stageNumber: 6, title: 'Подписание документов', status: 'IN_PROGRESS', deadline: new Date('2026-07-30T09:00:00.000Z') },
      ],
      general: [],
      now: NOW,
    })
    expect(items.map((item) => item.priority)).toEqual(['CRITICAL', 'HIGH', 'MEDIUM'])
    expect(items[0]!.action).toContain('Просрочен этап 6')
    expect(items[1]!.action).toContain('Заблокирован этап 7')
    expect(items[1]!.why).toContain('Вуз не подтвердил получение лицензии')
  })

  it('просроченный и заблокированный этап: причина блокировки идёт в «почему» рекомендации', () => {
    const items = todayItems({
      own: [recommendation({ cooperationId: 'coop-2', relatedData: { stageNumber: 7, daysOverdue: 18 } })],
      stages: [blockedStage],
      general: [],
      now: NOW,
    })
    expect(items).toHaveLength(1)
    expect(items[0]!.why).toContain('Причина блокировки: Вуз не подтвердил получение лицензии.')
  })

  it('этап за незавершённой контрольной точкой в дела не попадает', () => {
    const locked: ProblemStageInput = {
      ...blockedStage,
      status: 'NOT_STARTED',
      deadline: new Date('2026-08-13T09:00:00.000Z'),
      blockingReason: null,
      siblings: [
        { stageNumber: 6, title: 'Подписание документов', status: 'IN_PROGRESS' },
        { stageNumber: 7, title: blockedStage.title, status: 'NOT_STARTED' },
      ],
    }
    expect(todayItems({ own: [], stages: [locked], general: [], now: NOW })).toEqual([])
  })

  it('своих дел меньше трёх — добираются общие; больше семи не бывает', () => {
    const general = Array.from({ length: 10 }, (_, index) =>
      recommendation({ id: `gen-${index}`, ruleKey: 'program.missing-metrics', priority: 'HIGH', title: `Нет данных ${index}` }),
    )
    expect(todayItems({ own: [recommendation()], stages: [], general, now: NOW })).toHaveLength(3)

    const many = Array.from({ length: 10 }, (_, index) => recommendation({ id: `own-${index}`, cooperationId: `coop-${index}` }))
    expect(todayItems({ own: many, stages: [], general, now: NOW })).toHaveLength(7)
  })

  it('промпт требует ровно столько пунктов и отвергает ответ с другим числом', () => {
    const items = todayItems({ own: [recommendation()], stages: [blockedStage], general: [], now: NOW })
    const prompt = buildTodayPrompt(items, redactor())
    expect(prompt.system).toContain('Пунктов ровно 2')
    expect(prompt.accepts('1. Закройте этап 6.\nПочему: срок.\n2. Снимите блокировку.\nПочему: лицензия.')).toBe(true)
    expect(prompt.accepts('1. Закройте этап 6.\nПочему: срок.')).toBe(false)
  })
})

describe('ответ модели', () => {
  it('разметка Markdown убирается, пустые строки сжимаются', () => {
    expect(cleanModelText('## Сводка\n\n\n\n**Этап 6** просрочен.')).toBe('Сводка\n\nЭтап 6 просрочен.')
  })

  it('слишком длинный ответ обрезается', () => {
    expect(cleanModelText('а'.repeat(AI_ASSIST_LIMITS.maxTextLength + 100)).length).toBe(
      AI_ASSIST_LIMITS.maxTextLength + 1,
    )
  })
})

// ─────────────────────── Модель, запасной шаблон, лимиты ─────────────────────

describe('черновик: модель или запасной шаблон', () => {
  const redact = redactor()

  it('модель ответила — её текст, источник и модель', async () => {
    const { provider } = fakeProvider(answering('Связка на этапе 6.'))
    const { draft } = await compose(simplePrompt(), 'u1', { redact, provider, now: NOW })
    expect(draft).toMatchObject({
      text: 'Связка на этапе 6.',
      source: 'yandexgpt',
      model: 'yandexgpt-lite',
      fallbackReason: null,
      cached: false,
      facts: ['Факт'],
    })
    expect(aiDraftSourceNote(draft)).toBe('Черновик ИИ (YandexGPT) — проверьте перед отправкой')
  })

  it('помощник выключен — шаблон, модель не вызывается', async () => {
    const provider = new DisabledLlmProvider()
    const spy = vi.spyOn(provider, 'generate')
    const { draft } = await compose(simplePrompt(), 'u1', { redact, provider, now: NOW })
    expect(draft).toMatchObject({ text: 'Шаблонный текст', source: 'template', model: null, fallbackReason: 'disabled' })
    expect(spy).not.toHaveBeenCalled()
    expect(aiDraftSourceNote(draft)).toBe('Шаблон без ИИ: помощник не подключён')
  })

  it('провайдер без ключа — шаблон «не настроен»', async () => {
    const { provider } = fakeProvider(answering('x'), { ready: false })
    const { draft } = await compose(simplePrompt(), 'u1', { redact, provider, now: NOW })
    expect(draft.fallbackReason).toBe('not-configured')
    expect(provider.generate).not.toHaveBeenCalled()
  })

  it.each([
    ['таймаут', new LlmError('timeout', 'долго'), 'timeout'],
    ['ошибка сети', new Error('fetch failed'), 'failed'],
    ['отказ фильтра', new LlmError('empty', 'фильтр'), 'empty'],
  ] as const)('сбой модели (%s) — шаблон, а не ошибка', async (_name, error, reason) => {
    const { provider } = fakeProvider(async () => {
      throw error
    })
    const { draft } = await compose(simplePrompt(), 'u1', { redact, provider, now: NOW })
    expect(draft).toMatchObject({ source: 'template', text: 'Шаблонный текст', fallbackReason: reason })
  })

  it('пустой ответ и ответ не по формату — шаблон', async () => {
    const empty = fakeProvider(answering('  **  '))
    expect((await compose(simplePrompt(), 'u1', { redact, provider: empty.provider, now: NOW })).draft.fallbackReason).toBe('empty')

    const wrong = fakeProvider(answering('Текст'))
    const prompt = simplePrompt('Другие факты', { accepts: () => false })
    expect((await compose(prompt, 'u1', { redact, provider: wrong.provider, now: NOW })).draft.fallbackReason).toBe('invalid')
  })

  it('нечего формулировать — шаблон без вызова модели', async () => {
    const { provider } = fakeProvider(answering('x'))
    const { draft } = await compose(simplePrompt('Факты', { facts: [] }), 'u1', { redact, provider, now: NOW })
    expect(draft.fallbackReason).toBe('no-facts')
    expect(provider.generate).not.toHaveBeenCalled()
  })

  it('выдуманные моделью телефон и ФИО вычищаются из ответа', async () => {
    const { provider } = fakeProvider(answering('Позвоните Кириллову П. А. по +7 900 000-00-00.'))
    const { draft } = await compose(simplePrompt(), 'u1', { redact, provider, now: NOW })
    expect(draft.text).toBe('Позвоните ответственный по [телефон скрыт].')
  })

  it('те же факты в течение 10 минут — ответ из кэша, модель не вызывается повторно', async () => {
    const { provider } = fakeProvider(answering('Из модели'))
    await compose(simplePrompt(), 'u1', { redact, provider, now: NOW })
    const second = await compose(simplePrompt(), 'u2', { redact, provider, now: new Date(NOW.getTime() + 60_000) })
    expect(second.draft).toMatchObject({ text: 'Из модели', cached: true, source: 'yandexgpt' })
    expect(provider.generate).toHaveBeenCalledTimes(1)

    const later = await compose(simplePrompt(), 'u2', {
      redact,
      provider,
      now: new Date(NOW.getTime() + AI_ASSIST_LIMITS.cacheTtlMs + 1),
    })
    expect(later.draft.cached).toBe(false)
    expect(provider.generate).toHaveBeenCalledTimes(2)
  })

  it('шаблон в кэш не попадает: после сбоя модель спрашивается снова', async () => {
    let fail = true
    const { provider } = fakeProvider(async () => {
      if (fail) throw new Error('503')
      return { text: 'Ответ', model: 'yandexgpt-lite' }
    })
    expect((await compose(simplePrompt(), 'u1', { redact, provider, now: NOW })).draft.source).toBe('template')
    fail = false
    expect((await compose(simplePrompt(), 'u1', { redact, provider, now: NOW })).draft.source).toBe('yandexgpt')
  })
})

describe('лимит генераций', () => {
  const redact = redactor()

  it(`${AI_ASSIST_LIMITS.generationsPerWindow} обращений в час, дальше — шаблон; у другого пользователя свой счёт`, async () => {
    const { provider } = fakeProvider(async (request) => ({ text: `Ответ на ${request.user}`, model: 'm' }))
    for (let index = 0; index < AI_ASSIST_LIMITS.generationsPerWindow; index += 1) {
      const { draft } = await compose(simplePrompt(`Факты ${index}`), 'u1', { redact, provider, now: NOW })
      expect(draft.source).toBe('yandexgpt')
    }
    const blocked = await compose(simplePrompt('Ещё'), 'u1', { redact, provider, now: NOW })
    expect(blocked.draft.fallbackReason).toBe('rate-limited')
    expect(provider.generate).toHaveBeenCalledTimes(AI_ASSIST_LIMITS.generationsPerWindow)

    const other = await compose(simplePrompt('Ещё'), 'u2', { redact, provider, now: NOW })
    expect(other.draft.source).toBe('yandexgpt')

    // Ответ из кэша лимит не расходует и при исчерпанном лимите отдаётся.
    const cached = await compose(simplePrompt('Факты 0'), 'u1', { redact, provider, now: NOW })
    expect(cached.draft.cached).toBe(true)
  })

  it('окно скользит: через час обращения снова доступны', () => {
    const start = NOW.getTime()
    for (let index = 0; index < AI_ASSIST_LIMITS.generationsPerWindow; index += 1) {
      expect(takeGeneration('u3', start + index)).toBe(true)
    }
    expect(takeGeneration('u3', start + 100)).toBe(false)
    expect(generationsLeft('u3', start + 100)).toBe(0)
    expect(takeGeneration('u3', start + AI_ASSIST_LIMITS.windowMs + 100)).toBe(true)
  })
})

// ─────────────────────────── Сервис: права и журнал ─────────────────────────

describe('права', () => {
  it('сводка: все, кому видна аналитика; представителю вуза — 403 без запросов к данным', async () => {
    for (const role of ['ADMIN', 'MANAGER', 'ANALYST', 'VIEWER'] as const) {
      await expect(summarizeCooperation(as(role), 'coop-1')).resolves.toMatchObject({ source: 'template' })
    }
    mocks.getCooperation.mockClear()
    await expect(summarizeCooperation(as('UNIVERSITY_REP'), 'coop-1')).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(mocks.getCooperation).not.toHaveBeenCalled()
  })

  it('сводка по чужой или несуществующей связке — 404 карточки связки', async () => {
    mocks.getCooperation.mockRejectedValueOnce(notFound('Связка не найдена'))
    await expect(summarizeCooperation(as('MANAGER'), 'nope')).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('письмо: только ADMIN и MANAGER', async () => {
    for (const role of ['ADMIN', 'MANAGER'] as const) {
      await expect(draftRecommendationLetter(as(role), 'rec-overdue')).resolves.toMatchObject({
        kind: 'recommendation-letter',
      })
    }
    for (const role of ['ANALYST', 'VIEWER', 'UNIVERSITY_REP'] as const) {
      await expect(draftRecommendationLetter(as(role), 'rec-overdue')).rejects.toMatchObject({ code: 'FORBIDDEN' })
    }
  })

  it('письмо по несуществующей рекомендации — 404', async () => {
    mocks.getRecommendation.mockRejectedValueOnce(notFound('Рекомендация не найдена'))
    await expect(draftRecommendationLetter(as('MANAGER'), 'nope')).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('дела на сегодня: всем, кроме представителя вуза', async () => {
    await expect(todayPlan(as('ANALYST'))).resolves.toMatchObject({ kind: 'today' })
    await expect(todayPlan(as('UNIVERSITY_REP'))).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })
})

describe('сервис целиком', () => {
  it('без настроек — шаблон с пометкой «не подключён», журнал без текста', async () => {
    const draft = await summarizeCooperation(as('MANAGER'), 'coop-1')
    expect(draft).toMatchObject({ kind: 'cooperation-summary', source: 'template', fallbackReason: 'disabled' })
    expect(draft.text).toContain('на этапе 6')

    expect(mocks.writeAudit).toHaveBeenCalledTimes(1)
    const entry = mocks.writeAudit.mock.calls[0]![0]
    expect(entry).toMatchObject({
      userId: 'user-MANAGER',
      action: 'ai.draft',
      objectType: 'Cooperation',
      objectId: 'coop-1',
      payload: { kind: 'cooperation-summary', provider: 'off', outcome: 'template', fallbackReason: 'disabled' },
    })
    expect(JSON.stringify(entry)).not.toContain(draft.text)
    expect(JSON.stringify(entry)).not.toContain('Подписание документов')
  })

  it('в модель уходят факты без ФИО, почты и телефонов', async () => {
    const cooperation = cooperationFixture()
    cooperation.stages[5] = stage(6, {
      status: 'BLOCKED',
      blockingReason: `Ждём: ${PERSONAL_TEXT}`,
      deadline: '2026-07-30T09:00:00.000Z',
      isOverdue: true,
      daysToDeadline: -57,
    })
    mocks.getCooperation.mockResolvedValue(cooperation)
    const { provider, requests } = fakeProvider(answering('Связка на этапе 6.'))
    mocks.getLlmProvider.mockReturnValue(provider)

    const draft = await summarizeCooperation(as('MANAGER'), 'coop-1')
    expect(draft).toMatchObject({ source: 'yandexgpt', text: 'Связка на этапе 6.' })
    expect(requests).toHaveLength(1)
    assertNoPersonalData(`${requests[0]!.system}\n${requests[0]!.user}`)
    expect(mocks.writeAudit.mock.calls[0]![0].payload).toMatchObject({ provider: 'yandexgpt', outcome: 'model' })
  })

  it('YandexGPT включён, но отвечает 500 — пользователь получает шаблон, а не ошибку', async () => {
    vi.stubEnv('AI_ASSIST_PROVIDER', 'yandexgpt')
    vi.stubEnv('YANDEX_GPT_API_KEY', 'test-key')
    vi.stubEnv('YANDEX_FOLDER_ID', 'b1gfolder')
    const fetchMock = vi.fn(async () => new Response('{"error":"internal"}', { status: 500 }))
    vi.stubGlobal('fetch', fetchMock)
    mocks.getLlmProvider.mockImplementation(realLlm.getLlmProvider)

    const draft = await todayPlan(as('MANAGER'))
    expect(draft).toMatchObject({ source: 'template', fallbackReason: 'failed' })
    expect(draft.text).toContain('Просрочен этап 6')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('дела на сегодня без единого дела — шаблон «дел нет», модель не зовётся', async () => {
    mocks.findOpenRecommendationsOf.mockResolvedValue([])
    const { provider } = fakeProvider(answering('x'))
    mocks.getLlmProvider.mockReturnValue(provider)
    const draft = await todayPlan(as('MANAGER'))
    expect(draft).toMatchObject({ source: 'template', fallbackReason: 'no-facts', facts: [] })
    expect(provider.generate).not.toHaveBeenCalled()
  })
})
