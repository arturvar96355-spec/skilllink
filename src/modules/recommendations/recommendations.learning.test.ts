import { describe, expect, it } from 'vitest'
import { RECOMMENDATION_LEARNING, RECOMMENDATION_RULES, SKILL_GAP } from '@/shared/config/analytics.config'
import type { RecommendationPriority, StageStatus } from '@/shared/contracts/enums'
import {
  DAY_MS,
  applyEvent,
  betaCdf,
  betaMean,
  coolDown,
  computeScore,
  credibleInterval90,
  decayFactor,
  dismissalPause,
  globalPosterior,
  indexStats,
  isOverloaded,
  isPauseOver,
  pooledPosterior,
  ruleProbability,
  sampleBeta,
  scoreRecommendation,
  seededRandom,
  shouldDefer,
  statsKey,
  type RuleStatsState,
} from './recommendations.learning'
import { explainRule, isRuleEnabled, planRescore } from './recommendations.explain'
import { simulateDecisions, syntheticCandidates } from './recommendations.simulation'
import { REASON_CODES, REASON_TEXTS, allPass, reason } from './recommendations.reasons'
import {
  draftsForCooperation,
  evaluateCooperation,
  evaluateMissingMetrics,
  evaluateSkillGaps,
  progressedSince,
  stalledDaysThreshold,
  type CooperationRuleInput,
} from './recommendations.rules'

const NOW = new Date('2026-09-21T00:00:00.000Z')
const at = (days: number) => new Date(NOW.getTime() + days * DAY_MS)
const H = RECOMMENDATION_LEARNING.halfLifeDays

const show = (days: number) => ({ at: at(days), trials: 1, successes: 0 })
const success = (days: number) => ({ at: at(days), trials: 0, successes: 1 })

function replay(events: ReadonlyArray<{ at: Date; trials: number; successes: number }>): RuleStatsState | null {
  return events.reduce<RuleStatsState | null>((state, event) => applyEvent(state, event, H), null)
}

describe('затухание: полураспад и инварианты', () => {
  it('через период полураспада событие весит вдвое меньше, через два — вчетверо', () => {
    const state = replay([show(0)])
    expect(coolDown(state, at(H), H).trialsEff).toBeCloseTo(0.5, 12)
    expect(coolDown(state, at(2 * H), H).trialsEff).toBeCloseTo(0.25, 12)
    expect(decayFactor(at(0), at(H), H)).toBeCloseTo(0.5, 12)
  })

  it('новое событие: eff·coef + приращение, полные счётчики не затухают', () => {
    const state = replay([show(0), show(H)])!
    expect(state.trialsEff).toBeCloseTo(1.5, 12)
    expect(state.trials).toBe(2)
    expect(state.effUpdatedAt).toEqual(at(H))
  })

  it('дробные счётчики не округляются', () => {
    const state = replay([show(0), show(7), success(11)])!
    expect(Number.isInteger(state.trialsEff)).toBe(false)
    expect(state.trialsEff).toBeCloseTo(1 * 0.5 ** (11 / H) + 0.5 ** (4 / H), 12)
  })

  it('событие «из прошлого» не состаривает запись и не растит вес', () => {
    const state = replay([show(10), show(5)])!
    expect(state.effUpdatedAt).toEqual(at(10))
    expect(state.trialsEff).toBe(2)
  })

  it('успехов не больше показов — и в эффективных, и в полных счётчиках', () => {
    const random = seededRandom(119)
    for (let run = 0; run < 200; run += 1) {
      let state: RuleStatsState | null = null
      let day = 0
      for (let step = 0; step < 40; step += 1) {
        day += random() * 20
        const event = random() < 0.4 ? success(day) : show(day)
        state = applyEvent(state, event, H)
        expect(state.successesEff).toBeLessThanOrEqual(state.trialsEff)
        expect(state.successes).toBeLessThanOrEqual(state.trials)
        const cooled = coolDown(state, at(day + random() * 100), H)
        expect(cooled.successesEff).toBeLessThanOrEqual(cooled.trialsEff)
      }
    }
  })

  it('успех по давнему показу подтягивает показы до успехов (max), а не ломает инвариант', () => {
    const state = replay([show(0), success(90)])!
    // Показ остыл до 1/8, успех весит 1 — показы подтянуты до 1.
    expect(state.successesEff).toBe(1)
    expect(state.trialsEff).toBe(1)
  })
})

describe('вероятность полезности правила', () => {
  it('без данных — ровно 0,5, источник общий', () => {
    const result = ruleProbability(new Map(), 'cooperation.stalled', { universityId: 'u', managerId: 'm' }, NOW)
    expect(result.p).toBe(0.5)
    expect(result.pSource).toBe('global')
    expect(betaMean(globalPosterior({ trialsEff: 0, successesEff: 0 }))).toBe(0.5)
  })

  it('общий уровень: (1 + s) / (2 + t)', () => {
    expect(betaMean(globalPosterior({ trialsEff: 8, successesEff: 6 }))).toBeCloseTo(7 / 10, 12)
  })

  it('пулинг: мало своих данных — ближе к общей оценке, много — к своей', () => {
    const k = RECOMMENDATION_LEARNING.poolingStrength
    expect(betaMean(pooledPosterior({ trialsEff: 2, successesEff: 0 }, 0.8, k))).toBeCloseTo((0 + k * 0.8) / (2 + k), 12)
    const lots = betaMean(pooledPosterior({ trialsEff: 200, successesEff: 20 }, 0.8, k))
    expect(Math.abs(lots - 0.1)).toBeLessThan(0.02)
  })

  it('пулинг непрерывен: на границе «мало / достаточно данных» балл не прыгает', () => {
    const k = RECOMMENDATION_LEARNING.poolingStrength
    const below = betaMean(pooledPosterior({ trialsEff: 4.999, successesEff: 1 }, 0.6, k))
    const above = betaMean(pooledPosterior({ trialsEff: 5.001, successesEff: 1 }, 0.6, k))
    expect(Math.abs(below - above)).toBeLessThan(0.001)
  })

  it('источник: своих нет — global, мало — pooled, достаточно — local', () => {
    const state = (trials: number, successes: number): RuleStatsState => ({
      trials,
      successes,
      trialsEff: trials,
      successesEff: successes,
      effUpdatedAt: NOW,
    })
    const rule = 'cooperation.stalled'
    const index = indexStats([
      { ruleType: rule, scopeType: 'global', scopeId: 'all', ...state(40, 30) },
      { ruleType: rule, scopeType: 'university', scopeId: 'u-small', ...state(2, 0) },
      { ruleType: rule, scopeType: 'university', scopeId: 'u-big', ...state(30, 3) },
    ])
    expect(ruleProbability(index, rule, { universityId: null, managerId: null }, NOW).pSource).toBe('global')
    const small = ruleProbability(index, rule, { universityId: 'u-small', managerId: null }, NOW)
    expect(small.pSource).toBe('pooled')
    expect(small.level).toBe('university')
    const pGlobal = 31 / 42
    expect(small.p).toBeCloseTo((0 + 5 * pGlobal) / (2 + 5), 12)
    const big = ruleProbability(index, rule, { universityId: 'u-big', managerId: null }, NOW)
    expect(big.pSource).toBe('local')
    expect(big.p).toBeLessThan(small.p)
  })

  it('менеджер пулится с вузом, вуз — с общей оценкой', () => {
    const rule = 'stage.overdue'
    const index = indexStats([
      { ruleType: rule, scopeType: 'global', scopeId: 'all', trials: 10, successes: 5, trialsEff: 10, successesEff: 5, effUpdatedAt: NOW },
      { ruleType: rule, scopeType: 'university', scopeId: 'u', trials: 5, successes: 5, trialsEff: 5, successesEff: 5, effUpdatedAt: NOW },
      { ruleType: rule, scopeType: 'manager', scopeId: 'm', trials: 1, successes: 0, trialsEff: 1, successesEff: 0, effUpdatedAt: NOW },
    ])
    const pUniversity = (5 + 5 * 0.5) / (5 + 5)
    const pManager = (0 + 5 * pUniversity) / (1 + 5)
    expect(ruleProbability(index, rule, { universityId: 'u', managerId: 'm' }, NOW).p).toBeCloseTo(pManager, 12)
  })

  it('остывшая статистика тянется обратно к 0,5', () => {
    const rule = 'cooperation.stalled'
    const index = indexStats([
      { ruleType: rule, scopeType: 'global', scopeId: 'all', trials: 20, successes: 0, trialsEff: 20, successesEff: 0, effUpdatedAt: NOW },
    ])
    const fresh = ruleProbability(index, rule, { universityId: null, managerId: null }, NOW).p
    const later = ruleProbability(index, rule, { universityId: null, managerId: null }, at(4 * H)).p
    expect(fresh).toBeCloseTo(1 / 22, 12)
    expect(later).toBeGreaterThan(fresh)
    expect(later).toBeLessThan(0.5)
  })
})

describe('интервал Beta и выборка Томпсона', () => {
  it('функция распределения совпадает с известными значениями', () => {
    expect(betaCdf(0.5, 2, 3)).toBeCloseTo(0.6875, 10)
    expect(betaCdf(0.3, 1, 1)).toBeCloseTo(0.3, 10)
  })

  it('90-процентный интервал Beta(1, 1) — [0,05; 0,95], сужается с данными', () => {
    const [low, high] = credibleInterval90({ alpha: 1, beta: 1 })
    expect(low).toBeCloseTo(0.05, 8)
    expect(high).toBeCloseTo(0.95, 8)
    const [narrowLow, narrowHigh] = credibleInterval90({ alpha: 51, beta: 51 })
    expect(narrowHigh - narrowLow).toBeLessThan(0.2)
    expect(narrowLow).toBeLessThan(0.5)
    expect(narrowHigh).toBeGreaterThan(0.5)
  })

  it('выборка с зерном повторяется и в среднем даёт среднее распределения', () => {
    const first = seededRandom(7)
    const second = seededRandom(7)
    expect(sampleBeta({ alpha: 3, beta: 5 }, first)).toBe(sampleBeta({ alpha: 3, beta: 5 }, second))
    const random = seededRandom(42)
    let sum = 0
    for (let index = 0; index < 4000; index += 1) sum += sampleBeta({ alpha: 3, beta: 5 }, random)
    expect(sum / 4000).toBeCloseTo(3 / 8, 1)
  })

  it('по умолчанию балл детерминирован (среднее), выборка — только за флагом', () => {
    expect(RECOMMENDATION_LEARNING.sampling).toBe('mean')
    const row = { ruleKey: 'stage.overdue', relatedData: { daysOverdue: 5 }, priority: 'HIGH' as const }
    const scopes = { universityId: null, managerId: null }
    const a = scoreRecommendation(row, scopes, new Map(), NOW, RECOMMENDATION_LEARNING, seededRandom(1))
    const b = scoreRecommendation(row, scopes, new Map(), NOW, RECOMMENDATION_LEARNING, seededRandom(2))
    expect(a.score).toBe(b.score)
    const thompson = { ...RECOMMENDATION_LEARNING, sampling: 'thompson' as const }
    const c = scoreRecommendation(row, scopes, new Map(), NOW, thompson, seededRandom(1))
    expect(c.breakdown.sampling).toBe('thompson')
  })
})

describe('итоговый балл', () => {
  const PRIORITIES: RecommendationPriority[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']

  it('всегда в [0..1]', () => {
    const random = seededRandom(3)
    for (let index = 0; index < 2000; index += 1) {
      const score = computeScore({
        p: random() * 1.2 - 0.1,
        value: random() * 500,
        anchor: 0.5 + random() * 50,
        priority: PRIORITIES[Math.floor(random() * 4)]!,
      })
      expect(score).toBeGreaterThanOrEqual(0)
      expect(score).toBeLessThanOrEqual(1)
    }
    expect(computeScore({ p: 1, value: 1e12, anchor: 1, priority: 'CRITICAL' })).toBeCloseTo(1, 9)
    expect(computeScore({ p: 0, value: 0, anchor: 1, priority: 'LOW' })).toBe(0)
  })

  it('не убывает по вероятности, ценности и приоритету', () => {
    const base = { p: 0.4, value: 5, anchor: 10, priority: 'MEDIUM' as const }
    expect(computeScore({ ...base, p: 0.6 })).toBeGreaterThan(computeScore(base))
    expect(computeScore({ ...base, value: 9 })).toBeGreaterThan(computeScore(base))
    expect(computeScore({ ...base, priority: 'HIGH' })).toBeGreaterThan(computeScore(base))
    for (let index = 1; index < PRIORITIES.length; index += 1) {
      expect(computeScore({ ...base, priority: PRIORITIES[index]! })).toBeGreaterThan(
        computeScore({ ...base, priority: PRIORITIES[index - 1]! }),
      )
    }
  })

  it('веса в сумме 1 и разбор сходится с баллом', () => {
    const { scoreWeightRule, scoreWeightValue, scoreWeightPriority } = RECOMMENDATION_LEARNING
    expect(scoreWeightRule + scoreWeightValue + scoreWeightPriority).toBeCloseTo(1, 12)
    const { score, breakdown } = scoreRecommendation(
      { ruleKey: 'cooperation.stalled', relatedData: { idleDays: 30 }, priority: 'MEDIUM' },
      { universityId: null, managerId: null },
      new Map(),
      NOW,
    )
    expect(breakdown.valueScore).toBeCloseTo(0.5, 12)
    expect(score).toBeCloseTo(
      breakdown.weights.rule * breakdown.p +
        breakdown.weights.value * breakdown.valueScore +
        breakdown.weights.priority * breakdown.priority,
      12,
    )
  })

  it('часто отклоняемое правило при прочих равных ниже', () => {
    const row = { ruleKey: 'cooperation.stalled', relatedData: { idleDays: 20 }, priority: 'MEDIUM' as const }
    const scopes = { universityId: null, managerId: null }
    const dismissed = indexStats([
      { ruleType: 'cooperation.stalled', scopeType: 'global', scopeId: 'all', trials: 30, successes: 2, trialsEff: 30, successesEff: 2, effUpdatedAt: NOW },
    ])
    expect(scoreRecommendation(row, scopes, dismissed, NOW).score).toBeLessThan(
      scoreRecommendation(row, scopes, new Map(), NOW).score,
    )
  })
})

describe('пауза после отклонения и защита от перегрузки', () => {
  const dismissed = { status: 'DISMISSED', resolvedAt: at(-10) }

  it('в пределах паузы — пауза идёт, до даты', () => {
    const pause = dismissalPause(dismissed, NOW)
    expect(pause.active).toBe(true)
    expect(pause.daysAgo).toBe(10)
    expect(pause.until).toEqual(at(RECOMMENDATION_LEARNING.dismissPauseDays - 10))
    expect(isPauseOver(dismissed, NOW)).toBe(false)
  })

  it('пауза кончилась — отклонённую можно открыть снова', () => {
    expect(isPauseOver(dismissed, at(RECOMMENDATION_LEARNING.dismissPauseDays))).toBe(true)
    expect(isPauseOver({ status: 'DONE', resolvedAt: at(-100) }, NOW)).toBe(false)
    expect(dismissalPause({ status: 'NEW', resolvedAt: null }, NOW).active).toBe(false)
  })

  it('перегружен: показов не меньше порога и выполнено меньше доли', () => {
    const min = RECOMMENDATION_LEARNING.overloadMinShown
    expect(isOverloaded({ shown: min, done: 0 })).toBe(true)
    expect(isOverloaded({ shown: min - 1, done: 0 })).toBe(false)
    expect(isOverloaded({ shown: 20, done: 2 })).toBe(false)
    expect(shouldDefer(0.3, true)).toBe(true)
    expect(shouldDefer(RECOMMENDATION_LEARNING.overloadScoreThreshold, true)).toBe(false)
    expect(shouldDefer(0.1, false)).toBe(false)
  })

  it('пересчёт: перегруженному — отложить слабое, причины обучения обновить, проверки правила сохранить', () => {
    const rows = [
      {
        id: 'weak',
        ruleKey: 'cooperation.stalled',
        priority: 'MEDIUM' as const,
        relatedData: { idleDays: 15 },
        reasons: [reason('cooperation_stalled', true, { idleDays: 15, threshold: 14 }), reason('rule_weight_low', false, { p: 0.1 })],
      },
      {
        id: 'strong',
        ruleKey: 'stage.overdue',
        priority: 'CRITICAL' as const,
        relatedData: { daysOverdue: 60 },
        reasons: [],
      },
    ]
    const scopes = new Map([
      ['weak', { universityId: 'u', managerId: 'm' }],
      ['strong', { universityId: 'u', managerId: 'm' }],
    ])
    const plan = planRescore(rows, scopes, new Map(), new Map([['m', { shown: 40, done: 1 }]]), NOW)
    const weak = plan.find((item) => item.id === 'weak')!
    const strong = plan.find((item) => item.id === 'strong')!
    expect(weak.isDeferred).toBe(true)
    expect(strong.isDeferred).toBe(false)
    expect(weak.reasons.map((item) => item.code)).toEqual(['cooperation_stalled', 'rule_weight_low', 'manager_overloaded'])
    expect(weak.reasons.find((item) => item.code === 'manager_overloaded')?.pass).toBe(false)
    // Без данных вес нейтральный — пометка «вес низкий» не срабатывает.
    expect(weak.reasons.find((item) => item.code === 'rule_weight_low')?.pass).toBe(true)
  })
})

// ─────────────────────── Объяснимость: одна функция проверок ────────────────

function cooperation(
  stages: Record<number, { status: StageStatus; deadline?: Date }>,
  overrides: Partial<CooperationRuleInput> = {},
): CooperationRuleInput {
  return {
    id: 'coop-1',
    productId: 'product-1',
    updatedAt: at(-1),
    university: { name: 'СПбГУТ' },
    program: { name: 'Программная инженерия' },
    stages: Array.from({ length: 14 }, (_, index) => {
      const stageNumber = index + 1
      const given = stages[stageNumber]
      return {
        stageNumber,
        title: `Этап ${stageNumber}`,
        status: given?.status ?? 'NOT_STARTED',
        deadline: given?.deadline ?? at(60),
        responsible: null,
        history: [],
        tasks: [],
      }
    }),
    ...overrides,
  }
}

const closedUpTo = (last: number): Record<number, { status: StageStatus }> =>
  Object.fromEntries(Array.from({ length: last }, (_, index) => [index + 1, { status: 'COMPLETED' }]))

describe('проверки правила — те же, что у пересборки («почему нет»)', () => {
  it('черновик есть ровно тогда, когда пройдены все проверки (на сотнях случайных связок)', () => {
    const random = seededRandom(2026)
    const STATUSES: StageStatus[] = ['NOT_STARTED', 'IN_PROGRESS', 'BLOCKED', 'COMPLETED', 'CANCELLED']
    for (let run = 0; run < 400; run += 1) {
      const stages: Record<number, { status: StageStatus; deadline?: Date }> = {}
      for (let number = 1; number <= 13; number += 1) {
        stages[number] = {
          status: STATUSES[Math.floor(random() * STATUSES.length)]!,
          deadline: at(Math.round(random() * 80 - 40)),
        }
      }
      const input = cooperation(stages, {
        productId: random() < 0.5 ? null : 'p',
        updatedAt: at(-Math.round(random() * 40)),
      })
      const evaluations = evaluateCooperation(input, NOW)
      for (const item of evaluations) expect(item.draft !== null).toBe(allPass(item.checks))
      expect(evaluations.flatMap((item) => (item.draft ? [item.draft] : []))).toEqual(
        draftsForCooperation(input, NOW),
      )
    }
  })

  it('по объекту с рекомендацией «почему нет» отвечает: всё пройдено', () => {
    const input = cooperation({ ...closedUpTo(5), 6: { status: 'IN_PROGRESS', deadline: at(-12) } })
    const evaluation = evaluateCooperation(input, NOW).find((item) => item.ruleKey === 'stage.overdue')!
    expect(evaluation.draft).not.toBeNull()
    const answer = explainRule({
      ruleKey: 'stage.overdue',
      enabled: true,
      objectChecks: [reason('cooperation_open', true)],
      evaluation,
      existing: { id: 'r1', status: 'NEW', resolvedAt: null, isDeferred: false },
      now: NOW,
    })
    expect(answer.wouldRecommend).toBe(true)
    expect(answer.checks.every((item) => item.pass)).toBe(true)
    expect(answer.checks.map((item) => item.check)).toEqual([
      'rule_enabled',
      'cooperation_open',
      'stage_overdue',
      'stage_unlocked',
      'dismissed_recently',
    ])
    // Причины у черновика — те же проверки.
    expect(evaluation.draft!.reasons).toEqual(evaluation.checks)
  })

  it('застой молчит из-за просрочки — и «почему нет» называет именно это', () => {
    const input = cooperation(
      { ...closedUpTo(5), 6: { status: 'IN_PROGRESS', deadline: at(-12) } },
      { updatedAt: at(-40) },
    )
    const stalled = evaluateCooperation(input, NOW).find((item) => item.ruleKey === 'cooperation.stalled')!
    expect(stalled.draft).toBeNull()
    const failed = stalled.checks.filter((item) => !item.pass)
    expect(failed.map((item) => item.code)).toEqual(['overdue_absent'])
    expect(failed[0]!.detail).toContain('просрочке этапа 6')
  })

  it('порог застоя читается одной функцией и попадает в факты', () => {
    const input = cooperation({ ...closedUpTo(3), 4: { status: 'IN_PROGRESS' } }, { updatedAt: at(-3) })
    const check = evaluateCooperation(input, NOW)
      .find((item) => item.ruleKey === 'cooperation.stalled')!
      .checks.find((item) => item.code === 'cooperation_stalled')!
    expect(check.pass).toBe(false)
    expect(check.facts.threshold).toBe(stalledDaysThreshold(4))
    expect(stalledDaysThreshold(4)).toBe(RECOMMENDATION_RULES.stalledDays)
    expect(check.detail).toBe(`Последнее движение 3 дн. назад — меньше порога ${stalledDaysThreshold(4)} дн.`)
  })

  it('отклонённая недавно: «почему нет» называет паузу и дату её конца', () => {
    const input = cooperation({ ...closedUpTo(5), 6: { status: 'IN_PROGRESS', deadline: at(-12) } })
    const answer = explainRule({
      ruleKey: 'stage.overdue',
      enabled: true,
      objectChecks: [],
      evaluation: evaluateCooperation(input, NOW)[0]!,
      existing: { id: 'r1', status: 'DISMISSED', resolvedAt: at(-3), isDeferred: false },
      now: NOW,
    })
    expect(answer.wouldRecommend).toBe(false)
    const pause = answer.checks.find((item) => item.check === 'dismissed_recently')!
    expect(pause.pass).toBe(false)
    expect(pause.detail).toMatch(/^Отклонена 3 дн\. назад, пауза до \d{2}\.\d{2}\.\d{4}$/)
  })

  it('выключенное правило — первая причина', () => {
    expect(isRuleEnabled('stage.overdue')).toBe(true)
    expect(isRuleEnabled('stage.overdue', ['stage.overdue'])).toBe(false)
    const answer = explainRule({
      ruleKey: 'stage.overdue',
      enabled: false,
      objectChecks: [],
      evaluation: null,
      existing: null,
      now: NOW,
    })
    expect(answer.checks[0]).toMatchObject({ check: 'rule_enabled', pass: false })
    expect(answer.checks[0]!.detail).toBe('Правило «Просроченный этап» выключено в настройках')
  })

  it('программа без сотрудничества: текст из фактов', () => {
    const evaluation = evaluateMissingMetrics({
      programId: 'p1',
      programName: 'Прикладная информатика',
      universityName: 'ДГТУ',
      applicationCount: null,
      studentCount: null,
      groupCount: 2,
      hasCooperation: false,
      cooperationCount: 0,
    })
    expect(evaluation.draft).toBeNull()
    const check = evaluation.checks.find((item) => item.code === 'program_cooperation_exists')!
    expect(check.pass).toBe(false)
    expect(check.detail).toBe(
      'У программы «Прикладная информатика» 0 действующих сотрудничеств — запрашивать показатели не у кого',
    )
  })

  it('дефициты: спрос, покрытие, продукт и очередь — у каждого навыка свои проверки', () => {
    const programs = [{ id: 'p1', name: 'ПИ', university: { name: 'СПбГУТ' } }]
    const demand = Array.from({ length: RECOMMENDATION_RULES.criticalGapLimit + 2 }, (_, index) => ({
      skillId: `s${index}`,
      value: 100 - index,
      region: 'Россия',
      skill: { id: `s${index}`, name: `Навык ${index}` },
    }))
    demand.push({ skillId: 'low', value: 1, region: 'Россия', skill: { id: 'low', name: 'Редкий' } })
    const productSkills = demand.map((row) => ({
      skillId: row.skillId,
      relevance: 'HIGH',
      product: { id: 'prod', name: 'Продукт' },
    }))
    const result = evaluateSkillGaps({ demand, programs, programSkills: [], productSkills })
    expect(result.shown).toHaveLength(RECOMMENDATION_RULES.criticalGapLimit)
    expect(result.deferred).toHaveLength(2)
    const queued = result.evaluations.find((item) => item.objectId === `s${RECOMMENDATION_RULES.criticalGapLimit}`)!
    expect(queued.draft).toBeNull()
    expect(queued.checks.find((item) => !item.pass)?.code).toBe('gap_in_top')
    const low = result.evaluations.find((item) => item.objectId === 'low')!
    const demandCheck = low.checks.find((item) => item.code === 'demand_above_threshold')!
    expect(demandCheck.pass).toBe(false)
    expect(demandCheck.facts.threshold).toBe(Math.round(SKILL_GAP.demandThreshold * 100))
    for (const item of result.evaluations) expect(item.draft !== null).toBe(allPass(item.checks))
  })
})

describe('бонус «связка сдвинулась»', () => {
  it('текущий этап дальше того, о котором была рекомендация, — сдвиг', () => {
    expect(progressedSince('stage.overdue', { stageNumber: 6 }, 7)).toBe(true)
    expect(progressedSince('stage.overdue', { stageNumber: 6 }, 6)).toBe(false)
    expect(progressedSince('cooperation.stalled', { stageNumber: 4 }, null)).toBe(true)
    expect(progressedSince('cooperation.no-product', { currentStageNumber: 5 }, 6)).toBe(true)
    expect(progressedSince('program.missing-metrics', { stageNumber: 1 }, 9)).toBe(false)
  })
})

describe('словарь причин', () => {
  it('у каждого кода есть подпись и оба текста, код — «предмет_состояние»', () => {
    for (const code of REASON_CODES) {
      expect(REASON_TEXTS[code].label.length).toBeGreaterThan(0)
      expect(typeof REASON_TEXTS[code].pass({})).toBe('string')
      expect(typeof REASON_TEXTS[code].fail({})).toBe('string')
      expect(code).toMatch(/^[a-z]+(_[a-z]+)+$/)
    }
  })

  it('текст спроса собирается из фактов', () => {
    expect(
      reason('demand_above_threshold', true, { skillName: 'Python', demand: 87, threshold: 50, vacancies: 12 }).detail,
    ).toBe('Навык Python нужен рынку на 87 из 100 при пороге 50 (12 в замере)')
  })

  it('ключ статистики однозначен', () => {
    expect(statsKey('stage.overdue', 'global', 'all')).toBe('stage.overdue|global|all')
  })
})

describe('симуляция 90 дней решений', () => {
  const run = (seed: number) =>
    simulateDecisions({ candidates: syntheticCandidates(), days: 90, start: NOW, seed })

  it('детерминирована: одно зерно — одни цифры', () => {
    expect(run(119).snapshots).toEqual(run(119).snapshots)
    expect(run(119).events.length).toBe(run(119).events.length)
  })

  it('систематически отклоняемое правило к концу весит меньше всех', () => {
    const last = run(119).snapshots.at(-1)!
    const stalled = last.weights['cooperation.stalled']!
    for (const [rule, weight] of Object.entries(last.weights)) {
      if (rule !== 'cooperation.stalled') expect(weight).toBeGreaterThan(stalled)
    }
    expect(stalled).toBeLessThan(0.25)
  })

  it('события идут по времени — как их запишет база', () => {
    const { events } = run(5)
    for (let index = 1; index < events.length; index += 1) {
      expect(events[index]!.at.getTime()).toBeGreaterThanOrEqual(events[index - 1]!.at.getTime())
    }
  })
})
