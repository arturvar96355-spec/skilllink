import { describe, expect, it } from 'vitest'
import { RECOMMENDATION_RULES } from '@/shared/config/analytics.config'
import { updateRecommendationSchema } from './recommendations.schema'
import {
  compareDraftsByImportance,
  type RecommendationDraft,
  ruleCooperationWithoutProduct,
  ruleCriticalGapWithProduct,
  ruleMissingProgramMetrics,
  ruleOverdueStage,
  lastCooperationActivity,
  ruleStalledCooperation,
} from './recommendations.rules'

const NOW = new Date('2026-09-21T00:00:00.000Z')
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000)
const daysAhead = (days: number) => new Date(NOW.getTime() + days * 24 * 60 * 60 * 1000)

describe('правило: просроченный этап', () => {
  const base = {
    cooperationId: 'coop-1',
    universityName: 'СПбГУТ',
    programName: 'Программная инженерия',
    stageNumber: 6,
    stageTitle: 'Подписание документов',
    status: 'IN_PROGRESS' as const,
    responsibleName: 'Кириллов Пётр Андреевич',
  }

  it('молчит, пока срок не прошёл', () => {
    expect(ruleOverdueStage({ ...base, deadline: daysAhead(5) }, NOW)).toBeNull()
  })

  it('молчит для завершённого и отменённого этапа', () => {
    expect(
      ruleOverdueStage({ ...base, status: 'COMPLETED', deadline: daysAgo(30) }, NOW),
    ).toBeNull()
    expect(
      ruleOverdueStage({ ...base, status: 'CANCELLED', deadline: daysAgo(30) }, NOW),
    ).toBeNull()
  })

  it('срабатывает на просроченном этапе и называет объём просрочки', () => {
    const draft = ruleOverdueStage({ ...base, deadline: daysAgo(3) }, NOW)
    expect(draft).not.toBeNull()
    expect(draft?.ruleKey).toBe('stage.overdue')
    expect(draft?.relatedData.daysOverdue).toBe(3)
    expect(draft?.justification).toContain('3 дн.')
    expect(draft?.cooperationId).toBe('coop-1')
  })

  it('поднимает приоритет вместе с длительностью просрочки', () => {
    expect(ruleOverdueStage({ ...base, deadline: daysAgo(1) }, NOW)?.priority).toBe('MEDIUM')
    expect(
      ruleOverdueStage(
        { ...base, deadline: daysAgo(RECOMMENDATION_RULES.overdueHighDays) },
        NOW,
      )?.priority,
    ).toBe('HIGH')
    expect(
      ruleOverdueStage(
        { ...base, deadline: daysAgo(RECOMMENDATION_RULES.overdueCriticalDays) },
        NOW,
      )?.priority,
    ).toBe('CRITICAL')
  })

  it('в день срока — уже просрочка, как на главной, а не тишина', () => {
    // Раньше здесь было пусто, и вместо просрочки срабатывало «связка без движения».
    const draft = ruleOverdueStage({ ...base, deadline: new Date(NOW.getTime() - 60_000) }, NOW)
    expect(draft?.ruleKey).toBe('stage.overdue')
    expect(draft?.relatedData.daysOverdue).toBe(0)
    expect(draft?.justification).toContain('истёк сегодня')
    expect(draft?.priority).toBe('MEDIUM')
  })

  it('срок ещё не наступил — молчит', () => {
    expect(ruleOverdueStage({ ...base, deadline: new Date(NOW.getTime() + 60_000) }, NOW)).toBeNull()
  })

  it('называет ответственного, когда он известен', () => {
    const draft = ruleOverdueStage({ ...base, deadline: daysAgo(5) }, NOW)
    expect(draft?.justification).toContain('Кириллов')

    const anonymous = ruleOverdueStage(
      { ...base, responsibleName: null, deadline: daysAgo(5) },
      NOW,
    )
    expect(anonymous?.justification).not.toContain('Ответственный')
  })
})

describe('правило: связка без движения', () => {
  const base = {
    cooperationId: 'coop-2',
    universityName: 'МТУСИ',
    programName: 'Облачные технологии',
    stageNumber: 3,
    stageTitle: 'Организация встречи',
    stageStatus: 'NOT_STARTED' as const,
  }

  it('молчит, пока порог не превышен', () => {
    const draft = ruleStalledCooperation(
      { ...base, lastActivityAt: daysAgo(RECOMMENDATION_RULES.stalledDays - 1) },
      NOW,
    )
    expect(draft).toBeNull()
  })

  it('срабатывает на пороге', () => {
    const draft = ruleStalledCooperation(
      { ...base, lastActivityAt: daysAgo(RECOMMENDATION_RULES.stalledDays) },
      NOW,
    )
    expect(draft?.ruleKey).toBe('cooperation.stalled')
    expect(draft?.relatedData.idleDays).toBe(RECOMMENDATION_RULES.stalledDays)
  })

  it('ловит застой и на начатом этапе, не только на неначатом', () => {
    const draft = ruleStalledCooperation(
      { ...base, stageStatus: 'IN_PROGRESS', lastActivityAt: daysAgo(30) },
      NOW,
    )
    expect(draft).not.toBeNull()
    expect(draft?.description).toContain('Продвиньте этап')
    expect(draft?.priority).toBe('MEDIUM')
  })

  it('предлагает начать этап, если он не начат', () => {
    const draft = ruleStalledCooperation({ ...base, lastActivityAt: daysAgo(30) }, NOW)
    expect(draft?.description).toContain('Начните этап')
  })

  it('повышает приоритет для давно заблокированного этапа', () => {
    const draft = ruleStalledCooperation(
      { ...base, stageStatus: 'BLOCKED', lastActivityAt: daysAgo(30) },
      NOW,
    )
    expect(draft?.priority).toBe('HIGH')
    expect(draft?.description).toContain('Эскалируйте')
  })

  it('молчит для закрытого этапа', () => {
    expect(
      ruleStalledCooperation({ ...base, stageStatus: 'COMPLETED', lastActivityAt: daysAgo(90) }, NOW),
    ).toBeNull()
    expect(
      ruleStalledCooperation({ ...base, stageStatus: 'CANCELLED', lastActivityAt: daysAgo(90) }, NOW),
    ).toBeNull()
  })
})

describe('правило: критичный дефицит навыка и продукт', () => {
  const base = {
    skillId: 'skill-1',
    skillName: 'Kubernetes',
    demandNormalized: 0.8,
    products: [{ id: 'prod-1', name: 'Облачная платформа РТК', relevance: 'CORE' }],
    programs: [{ id: 'prog-1', name: 'DevOps', universityName: 'КНИТУ-КАИ' }],
  }

  it('молчит, если ни один продукт не даёт навык', () => {
    expect(ruleCriticalGapWithProduct({ ...base, products: [] })).toBeNull()
  })

  it('молчит, если нет программ, которым навыка не хватает', () => {
    expect(ruleCriticalGapWithProduct({ ...base, programs: [] })).toBeNull()
  })

  it('соединяет дефицит с продуктом и объясняет основание', () => {
    const draft = ruleCriticalGapWithProduct(base)
    expect(draft?.ruleKey).toBe('skill.critical-gap-with-product')
    expect(draft?.type).toBe('SKILL')
    expect(draft?.priority).toBe('HIGH')
    expect(draft?.title).toContain('Kubernetes')
    expect(draft?.justification).toContain('Облачная платформа РТК')
    expect(draft?.justification).toContain('80 из 100')
  })

  it('не перечисляет больше трёх программ в описании', () => {
    const many = Array.from({ length: 7 }, (_, index) => ({
      id: `prog-${index}`,
      name: `Программа ${index}`,
      universityName: 'Вуз',
    }))
    const draft = ruleCriticalGapWithProduct({ ...base, programs: many })
    expect(draft?.description).toContain('и ещё 4')
    expect(draft?.relatedData.programCount).toBe(7)
  })

  it('уверенность средняя: спрос считается по демонстрационному набору', () => {
    expect(ruleCriticalGapWithProduct(base)?.confidence).toBe('MEDIUM')
  })
})

describe('правило: нет показателей программы', () => {
  const base = {
    programId: 'prog-1',
    programName: 'Сети связи',
    universityName: 'КНИТУ-КАИ',
    applicationCount: null,
    studentCount: null,
    groupCount: null,
    hasCooperation: true,
  }

  it('молчит для программы без начатого сотрудничества', () => {
    // Требовать цифры у вуза, с которым не общаемся, бессмысленно.
    expect(ruleMissingProgramMetrics({ ...base, hasCooperation: false })).toBeNull()
  })

  it('молчит, когда все показатели заполнены', () => {
    expect(
      ruleMissingProgramMetrics({
        ...base,
        applicationCount: 100,
        studentCount: 50,
        groupCount: 2,
      }),
    ).toBeNull()
  })

  it('ноль считается заполненным значением', () => {
    expect(
      ruleMissingProgramMetrics({
        ...base,
        applicationCount: 0,
        studentCount: 0,
        groupCount: 0,
      }),
    ).toBeNull()
  })

  it('высокий приоритет, когда не заполнено ничего', () => {
    const draft = ruleMissingProgramMetrics(base)
    expect(draft?.priority).toBe('HIGH')
    expect(draft?.relatedData.missing).toEqual([
      'applicationCount',
      'studentCount',
      'groupCount',
    ])
  })

  it('средний приоритет, когда часть данных есть', () => {
    const draft = ruleMissingProgramMetrics({ ...base, applicationCount: 250, groupCount: 3 })
    expect(draft?.priority).toBe('MEDIUM')
    expect(draft?.relatedData.missing).toEqual(['studentCount'])
  })
})

describe('правило: связка без продукта', () => {
  const base = {
    cooperationId: 'coop-3',
    universityName: 'УрФУ',
    programName: 'Компьютерная безопасность',
    currentStageNumber: 5,
    hasProduct: false,
  }

  it('молчит, когда продукт выбран', () => {
    expect(ruleCooperationWithoutProduct({ ...base, hasProduct: true })).toBeNull()
  })

  it('молчит на ранних этапах: продукт выбирается не сразу', () => {
    expect(
      ruleCooperationWithoutProduct({
        ...base,
        currentStageNumber: RECOMMENDATION_RULES.productRequiredFromStage - 1,
      }),
    ).toBeNull()
  })

  it('срабатывает с этапа оформления', () => {
    const draft = ruleCooperationWithoutProduct({
      ...base,
      currentStageNumber: RECOMMENDATION_RULES.productRequiredFromStage,
    })
    expect(draft?.ruleKey).toBe('cooperation.no-product')
    expect(draft?.priority).toBe('HIGH')
  })

  it('молчит на контрольном этапе', () => {
    expect(ruleCooperationWithoutProduct({ ...base, currentStageNumber: 14 })).toBeNull()
  })
})

describe('изменение статуса рекомендации', () => {
  it('принимает рекомендацию без комментария', () => {
    expect(updateRecommendationSchema.safeParse({ status: 'ACCEPTED' }).success).toBe(true)
  })

  it('не даёт отклонить рекомендацию без основания', () => {
    const parsed = updateRecommendationSchema.safeParse({ status: 'DISMISSED' })
    expect(parsed.success).toBe(false)
    expect(parsed.success === false && parsed.error.issues[0]?.path).toEqual(['comment'])
  })

  it('отклоняет с комментарием', () => {
    expect(
      updateRecommendationSchema.safeParse({
        status: 'DISMISSED',
        comment: 'Вуз отказался от сотрудничества',
      }).success,
    ).toBe(true)
  })

  it('пустой комментарий не считается основанием', () => {
    expect(
      updateRecommendationSchema.safeParse({ status: 'DISMISSED', comment: '   ' }).success,
    ).toBe(false)
  })

  it('отклоняет неизвестный статус', () => {
    expect(updateRecommendationSchema.safeParse({ status: 'MAYBE' }).success).toBe(false)
  })
})

describe('порядок ленты рекомендаций', () => {
  const draft = (overrides: Partial<RecommendationDraft>): RecommendationDraft => ({
    ruleKey: 'stage.overdue',
    type: 'ACTION',
    objectType: 'Cooperation',
    objectId: 'c',
    title: 'Просрочен этап',
    description: '',
    priority: 'CRITICAL',
    justification: '',
    relatedData: {},
    confidence: 'HIGH',
    cooperationId: null,
    ...overrides,
  })

  it('при равной важности — сначала самая давняя просрочка', () => {
    // Три критичные просрочки создавались в одну миллисекунду, и сверху
    // после каждой перезаливки оказывалась случайная.
    const sorted = [
      draft({ objectId: 'ngtu', relatedData: { daysOverdue: 21 } }),
      draft({ objectId: 'spbgut', relatedData: { daysOverdue: 57 } }),
      draft({ objectId: 'kai', relatedData: { daysOverdue: 24 } }),
    ].sort(compareDraftsByImportance)
    expect(sorted.map((item) => item.objectId)).toEqual(['spbgut', 'kai', 'ngtu'])
  })

  it('важность главнее правила; внутри важности — просрочка, затем дефицит по спросу', () => {
    const sorted = [
      draft({ objectId: 'gap-low', ruleKey: 'skill.critical-gap-with-product', priority: 'HIGH', relatedData: { demandNormalized: 80 } }),
      draft({ objectId: 'stalled', ruleKey: 'cooperation.stalled', priority: 'MEDIUM' }),
      draft({ objectId: 'overdue-high', priority: 'HIGH', relatedData: { daysOverdue: 18 } }),
      draft({ objectId: 'gap-top', ruleKey: 'skill.critical-gap-with-product', priority: 'HIGH', relatedData: { demandNormalized: 100 } }),
      draft({ objectId: 'overdue-critical', relatedData: { daysOverdue: 30 } }),
    ].sort(compareDraftsByImportance)
    expect(sorted.map((item) => item.objectId)).toEqual([
      'overdue-critical',
      'overdue-high',
      'gap-top',
      'gap-low',
      'stalled',
    ])
  })

  it('порядок не зависит от того, в каком виде пришли черновики', () => {
    const items = [
      draft({ objectId: 'a', relatedData: { daysOverdue: 5 } }),
      draft({ objectId: 'b', relatedData: { daysOverdue: 5 } }),
      draft({ objectId: 'c', relatedData: { daysOverdue: 9 } }),
    ]
    const forward = [...items].sort(compareDraftsByImportance).map((item) => item.objectId)
    const backward = [...items].reverse().sort(compareDraftsByImportance).map((item) => item.objectId)
    expect(backward).toEqual(forward)
  })
})

describe('движение по связке', () => {
  it('закрытый вчера этап — это движение, даже если саму связку не правили месяц', () => {
    // Раньше правило смотрело только на запись связки и называло её «без движения 30 дн.».
    const last = lastCooperationActivity({
      updatedAt: daysAgo(30),
      stages: [
        { history: [{ changedAt: daysAgo(1) }], tasks: [] },
        { history: [], tasks: [{ doneAt: daysAgo(3) }] },
      ],
    })
    expect(last).toEqual(daysAgo(1))
  })

  it('отметка в чек-листе — тоже движение', () => {
    const last = lastCooperationActivity({
      updatedAt: daysAgo(30),
      stages: [{ history: [{ changedAt: daysAgo(20) }], tasks: [{ doneAt: daysAgo(2) }] }],
    })
    expect(last).toEqual(daysAgo(2))
  })

  it('без работы по этапам — время правки связки', () => {
    expect(lastCooperationActivity({ updatedAt: daysAgo(30), stages: [] })).toEqual(daysAgo(30))
  })
})

