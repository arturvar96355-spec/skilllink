import { PRODUCT_MATCH } from '@/shared/config/analytics.config'
import type {
  ConfidenceLevel,
  CooperationStatus,
  ProductSkillRelevance,
  SkillLevel,
} from '@/shared/contracts/enums'
import type {
  ProductMatchAdjustmentDto,
  ProductMatchExcludedDto,
  ProductMatchSkillDto,
  ProductRecommendationDto,
} from '@/shared/contracts/product-recommendation'
import {
  coverageByLevel,
  demandNormalizer,
  demandPerSkill,
  directionGroup,
  isInProfile,
  type DirectionProfile,
} from '@/modules/skills/skills.rules'
import { daysBetween } from '@/shared/utils/date'
import { outOf100 } from '@/shared/utils/number'
import { countWithNoun, plural } from '@/shared/utils/text'

/**
 * Рекомендации продуктов (решение 223): какой IT-продукт предложить программе.
 *
 * Контентная рекомендация по навыкам, без обучения: связок в системе десятки,
 * учить модель не на чем. Балл пары «программа × продукт» — насколько продукт
 * закрывает дефициты программы, взвешенно по спросу рынка:
 *
 * 1. Для каждого навыка продукта дефицит программы = спрос рынка − покрытие
 *    программой (как в `calculateGap`), не меньше нуля; нет данных о спросе — 0.
 * 2. Балл = средний дефицит по навыкам продукта, взвешенный значимостью навыка
 *    в продукте (ключевой 1, смежный 0,6, дополнительный 0,3); навык вне профиля
 *    направления — с половинным весом. Шкала 0–100.
 * 3. Поправки: продукт уже в связке с другой программой вуза — минус 15;
 *    связка этой программы с продуктом отменена за полгода — минус 40.
 *    Продукт уже подключён к программе — не предлагается вовсе.
 *
 * Спрос, покрытие и профиль — те же функции, что у дефицитов навыков
 * (`skills.rules.ts`): числа в причинах совпадают с вкладкой «Дефициты».
 */

export interface MatchProgramSkill {
  skillId: string
  level: SkillLevel
  category: string
}

export interface MatchProgram {
  id: string
  name: string
  code: string | null
  universityId: string
  universityName: string
  skills: readonly MatchProgramSkill[]
}

export interface MatchProductSkill {
  skillId: string
  name: string
  category: string
  relevance: ProductSkillRelevance
}

export interface MatchProduct {
  id: string
  name: string
  category: string
  skills: readonly MatchProductSkill[]
}

export interface MatchDemandRow {
  skillId: string
  value: number
  unit: string
  region: string
  isMock: boolean
}

export interface MatchCooperation {
  programId: string
  programName: string
  universityId: string
  productId: string | null
  productName: string | null
  status: CooperationStatus
  /** Когда связка закрыта (завершена или отменена); нет — берётся время последнего изменения. */
  closedAt: Date | null
  updatedAt: Date
}

export interface MatchContext {
  /** Нормированный спрос 0..1 и сырой замер по навыку. */
  demand: ReadonlyMap<string, { normalized: number; value: number; unit: string }>
  /** Профили групп направлений: что преподают программы группы (решение 98). */
  profiles: ReadonlyMap<string, DirectionProfile>
  cooperations: readonly MatchCooperation[]
  isMock: boolean
  now: Date
}

const OPEN_STATUSES: readonly CooperationStatus[] = ['DRAFT', 'ACTIVE', 'PAUSED']
/** Продукт уже у программы: связка идёт или завершена. Отменённая — не в счёт. */
const CONNECTED_STATUSES: readonly CooperationStatus[] = [...OPEN_STATUSES, 'COMPLETED']

/**
 * Профили групп направлений по программам выборки: навык в профиле, если его
 * или навыки той же области преподаёт кто-то из программ той же группы.
 * Та же логика, что у дефицитов одной программы (`skills.service.gaps`).
 */
export function buildProfiles(programs: readonly MatchProgram[]): Map<string, DirectionProfile> {
  const byGroup = new Map<string, { skillIds: Set<string>; categories: Set<string> }>()
  for (const program of programs) {
    const group = directionGroup(program.code)
    if (!group) continue
    const entry = byGroup.get(group) ?? { skillIds: new Set<string>(), categories: new Set<string>() }
    for (const skill of program.skills) {
      entry.skillIds.add(skill.skillId)
      entry.categories.add(skill.category)
    }
    byGroup.set(group, entry)
  }
  return new Map([...byGroup].map(([group, entry]) => [group, { group, ...entry }]))
}

/**
 * Спрос по навыкам: одна строка на навык (федеральный замер, без него — наибольший
 * региональный), нормировка по всем навыкам периода — как во вкладке «Дефициты».
 */
export function buildDemand(
  rows: readonly MatchDemandRow[],
): { demand: Map<string, { normalized: number; value: number; unit: string }>; isMock: boolean } {
  const perSkill = demandPerSkill(rows)
  const normalize = demandNormalizer(perSkill.map((row) => row.value))
  const demand = new Map<string, { normalized: number; value: number; unit: string }>()
  for (const row of perSkill) {
    const normalized = normalize(row.value)
    if (normalized !== null) demand.set(row.skillId, { normalized, value: row.value, unit: row.unit })
  }
  return { demand, isMock: perSkill.some((row) => row.isMock) }
}

export function relevanceWeight(relevance: ProductSkillRelevance): number {
  return PRODUCT_MATCH.relevanceWeight[relevance]
}

/** Единица замера — вакансии: в схеме по умолчанию `vacancies`, в демо-данных — «вакансий». */
export function isVacancyUnit(unit: string): boolean {
  return /^(vacancies|вакансия|вакансии|вакансий)$/i.test(unit.trim())
}

/** «1 240 вакансий» — сырой замер с единицей. */
function demandAmount(value: number, unit: string): string {
  const number = new Intl.NumberFormat('ru-RU').format(Math.round(value))
  if (isVacancyUnit(unit)) return `${number} ${plural(Math.round(value), ['вакансия', 'вакансии', 'вакансий'])}`
  return `${number} ${unit}`
}

const LEVEL_WORDS: Record<SkillLevel, string> = {
  BASIC: 'базовый уровень',
  INTERMEDIATE: 'средний уровень',
  ADVANCED: 'продвинутый уровень',
}

/** «Kubernetes (спрос 73, в программе нет)». */
export function skillPhrase(skill: Pick<ProductMatchSkillDto, 'name' | 'demand' | 'level'>): string {
  return `${skill.name} (спрос ${skill.demand}, в программе ${skill.level ? LEVEL_WORDS[skill.level] : 'нет'})`
}

export interface PairEvaluation {
  /** null — продукт этой программе не предлагается: `excluded` говорит почему. */
  recommendation: ProductRecommendationDto | null
  excluded: ProductMatchExcludedDto | null
}

/** Уверенность — по полноте данных, а не по баллу. */
export function confidenceOf(input: {
  programSkillCount: number
  productSkillCount: number
  productSkillsWithDemand: number
}): { confidence: ConfidenceLevel; note: string } {
  const lacks: string[] = []
  const demandShare = input.productSkillCount === 0 ? 0 : input.productSkillsWithDemand / input.productSkillCount
  if (input.programSkillCount === 0) {
    lacks.push('у программы не записано ни одного навыка — всё, что даёт продукт, выглядит дефицитом')
  } else if (input.programSkillCount < PRODUCT_MATCH.lowConfidenceProgramSkills) {
    lacks.push(
      `у программы записано только ${countWithNoun(input.programSkillCount, ['навык', 'навыка', 'навыков'])} — дефициты могут быть завышены`,
    )
  }
  if (demandShare < 1) {
    lacks.push(
      `спрос рынка известен для ${input.productSkillsWithDemand} из ${countWithNoun(input.productSkillCount, ['навыка', 'навыков', 'навыков'])} продукта`,
    )
  }
  if (input.productSkillCount < 2) lacks.push('у продукта записан один навык')

  const low =
    input.programSkillCount < PRODUCT_MATCH.lowConfidenceProgramSkills || demandShare < 0.5 || input.productSkillCount < 2
  const high =
    !low &&
    demandShare === 1 &&
    input.programSkillCount >= PRODUCT_MATCH.highConfidenceProgramSkills &&
    input.productSkillCount >= 3
  const confidence: ConfidenceLevel = low ? 'LOW' : high ? 'HIGH' : 'MEDIUM'

  const note =
    lacks.length === 0
      ? `Данных достаточно: у программы ${countWithNoun(input.programSkillCount, ['навык', 'навыка', 'навыков'])}, спрос известен по всем навыкам продукта`
      : `${confidence === 'LOW' ? 'Мало данных' : 'Данных не хватает'}: ${lacks.join('; ')}`
  return { confidence, note }
}

/**
 * Одна пара «программа × продукт»: балл, закрываемые дефициты, поправки, причины.
 */
export function evaluatePair(program: MatchProgram, product: MatchProduct, context: MatchContext): PairEvaluation {
  const excluded = (reason: string): PairEvaluation => ({
    recommendation: null,
    excluded: { productId: product.id, productName: product.name, programId: program.id, reason },
  })

  if (product.skills.length === 0) return excluded('У продукта не записано навыков — сравнить с программой не по чему')

  const connected = context.cooperations.find(
    (row) => row.programId === program.id && row.productId === product.id && CONNECTED_STATUSES.includes(row.status),
  )
  if (connected) {
    return excluded(
      connected.status === 'COMPLETED'
        ? 'Продукт уже передан программе — связка завершена'
        : 'Продукт уже подключён к программе — связка идёт',
    )
  }

  const levels = new Map(program.skills.map((skill) => [skill.skillId, skill.level]))
  const group = directionGroup(program.code)
  const profile = group ? (context.profiles.get(group) ?? null) : null

  let weighted = 0
  let weights = 0
  let withDemand = 0
  const closes: ProductMatchSkillDto[] = []
  for (const skill of product.skills) {
    const weight = relevanceWeight(skill.relevance)
    weights += weight
    const market = context.demand.get(skill.skillId)
    if (!market) continue
    withDemand += 1
    const level = levels.get(skill.skillId) ?? null
    const coverage = coverageByLevel(level)
    const gap = Math.max(0, market.normalized - coverage)
    const outOfProfile = profile !== null && level === null && !isInProfile({ id: skill.skillId, category: skill.category }, profile)
    weighted += gap * weight * (outOfProfile ? PRODUCT_MATCH.outOfProfileWeight : 1)
    if (gap >= PRODUCT_MATCH.minSkillGap) {
      closes.push({
        skillId: skill.skillId,
        name: skill.name,
        demand: outOf100(market.normalized),
        coverage: outOf100(coverage),
        level,
        gap: outOf100(gap),
        relevance: skill.relevance,
        outOfProfile,
        demandValue: market.value,
        demandUnit: market.unit,
      })
    }
  }
  closes.sort((a, b) => Number(a.outOfProfile) - Number(b.outOfProfile) || b.gap - a.gap || a.name.localeCompare(b.name, 'ru'))

  if (withDemand === 0) return excluded('Нет рыночных данных ни по одному навыку продукта')
  if (closes.length === 0) return excluded('Программа уже покрывает навыки продукта — дефицитов он не закрывает')

  const baseScore = weights > 0 ? Math.round((100 * weighted) / weights) : 0

  const adjustments: ProductMatchAdjustmentDto[] = []
  const sameUniversity = context.cooperations.find(
    (row) =>
      row.universityId === program.universityId &&
      row.programId !== program.id &&
      row.productId === product.id &&
      CONNECTED_STATUSES.includes(row.status),
  )
  if (sameUniversity) {
    adjustments.push({
      kind: 'same-university',
      points: -PRODUCT_MATCH.sameUniversityPenalty,
      text: `Вуз уже работает с продуктом по программе «${sameUniversity.programName}» — это расширение, а не новый продукт`,
    })
  }
  const cancelled = context.cooperations
    .filter((row) => row.programId === program.id && row.productId === product.id && row.status === 'CANCELLED')
    .map((row) => ({ row, days: daysBetween(row.closedAt ?? row.updatedAt, context.now) }))
    .filter((item) => item.days <= PRODUCT_MATCH.recentCancelDays)
    .sort((a, b) => a.days - b.days)[0]
  if (cancelled) {
    adjustments.push({
      kind: 'recent-cancel',
      points: -PRODUCT_MATCH.recentCancelPenalty,
      text: `Связка программы с этим продуктом отменена ${countWithNoun(Math.max(0, cancelled.days), ['день', 'дня', 'дней'])} назад — сначала выясните причину`,
    })
  }

  const score = Math.max(0, Math.min(100, baseScore + adjustments.reduce((sum, item) => sum + item.points, 0)))
  if (score < PRODUCT_MATCH.minScore) {
    return excluded(
      adjustments.length > 0
        ? `Балл ${score} после поправок: ${adjustments.map((item) => item.text.toLowerCase()).join('; ')}`
        : `Балл ${score} — продукт почти ничего не закрывает`,
    )
  }

  const { confidence, note } = confidenceOf({
    programSkillCount: program.skills.length,
    productSkillCount: product.skills.length,
    productSkillsWithDemand: withDemand,
  })

  return {
    recommendation: {
      program: { id: program.id, name: program.name, universityId: program.universityId, universityName: program.universityName },
      product: { id: product.id, name: product.name, category: product.category },
      score,
      baseScore,
      adjustments,
      closes,
      productSkillCount: product.skills.length,
      productSkillsWithDemand: withDemand,
      reasons: reasonsFor(program, product.id, closes, adjustments, context),
      confidence,
      confidenceNote: note,
      lowData: confidence === 'LOW',
    },
    excluded: null,
  }
}

/**
 * 2–4 причины данными: какие дефициты закроет, насколько востребован главный из них,
 * поправки, связи с вузом.
 */
export function reasonsFor(
  program: MatchProgram,
  productId: string,
  closes: readonly ProductMatchSkillDto[],
  adjustments: readonly ProductMatchAdjustmentDto[],
  context: MatchContext,
): string[] {
  const reasons: string[] = []
  const inProfile = closes.filter((skill) => !skill.outOfProfile)
  const listed = (inProfile.length > 0 ? inProfile : closes).slice(0, 3)
  const rest = closes.length - listed.length
  reasons.push(
    `Закроет ${countWithNoun(closes.length, ['дефицитный навык', 'дефицитных навыка', 'дефицитных навыков'])}: ` +
      `${listed.map(skillPhrase).join(', ')}${rest > 0 ? ` и ещё ${rest}` : ''}`,
  )

  const top = [...closes].sort((a, b) => b.demand - a.demand)[0]
  if (top) {
    const core = top.relevance === 'CORE' ? ' — ключевой навык продукта' : ''
    reasons.push(`Самый востребованный из них — ${top.name}: ${demandAmount(top.demandValue, top.demandUnit)} за период, спрос ${top.demand} из 100${core}`)
  }

  for (const adjustment of adjustments) reasons.push(`${adjustment.text} (${adjustment.points} к баллу)`)

  const warm = context.cooperations.find(
    (row) =>
      row.universityId === program.universityId &&
      OPEN_STATUSES.includes(row.status) &&
      row.productName !== null &&
      // Тот же продукт у вуза — уже в поправке «расширение», второй раз не называется.
      row.productId !== productId,
  )
  if (warm) {
    reasons.push(
      `У вуза уже идёт связка с продуктом «${warm.productName}» (программа «${warm.programName}») — удобно предложить на встрече по ней`,
    )
  }

  const outside = closes.filter((skill) => skill.outOfProfile)
  if (outside.length > 0) {
    reasons.push(
      `${outside.map((skill) => skill.name).join(', ')} — вне профиля направления: учтены с половинным весом`,
    )
  }
  return reasons.slice(0, 4)
}

/** Порядок: балл, затем число закрываемых дефицитов, затем название — устойчиво. */
export function compareRecommendations(a: ProductRecommendationDto, b: ProductRecommendationDto): number {
  return (
    b.score - a.score ||
    b.closes.length - a.closes.length ||
    a.product.name.localeCompare(b.product.name, 'ru') ||
    a.program.name.localeCompare(b.program.name, 'ru')
  )
}

export interface ProgramMatch {
  items: ProductRecommendationDto[]
  excluded: ProductMatchExcludedDto[]
}

/** Все продукты для одной программы — по убыванию балла. */
export function recommendForProgram(
  program: MatchProgram,
  products: readonly MatchProduct[],
  context: MatchContext,
): ProgramMatch {
  const items: ProductRecommendationDto[] = []
  const excluded: ProductMatchExcludedDto[] = []
  for (const product of products) {
    const result = evaluatePair(program, product, context)
    if (result.recommendation) items.push(result.recommendation)
    else if (result.excluded) excluded.push(result.excluded)
  }
  items.sort(compareRecommendations)
  return { items, excluded }
}

/**
 * Для вуза: пары по всем его программам, каждый продукт — один раз, на лучшей
 * для него программе. Вузу предлагают продукт, а не «продукт трижды».
 */
export function recommendForUniversity(
  programs: readonly MatchProgram[],
  products: readonly MatchProduct[],
  context: MatchContext,
): ProgramMatch {
  const best = new Map<string, ProductRecommendationDto>()
  const excluded: ProductMatchExcludedDto[] = []
  for (const program of programs) {
    const match = recommendForProgram(program, products, context)
    excluded.push(...match.excluded)
    for (const item of match.items) {
      const current = best.get(item.product.id)
      if (!current || compareRecommendations(item, current) < 0) best.set(item.product.id, item)
    }
  }
  return { items: [...best.values()].sort(compareRecommendations), excluded }
}

export interface ProductReach {
  productId: string
  productName: string
  /** Для скольких программ продукт — лучший вариант. */
  bestFor: number
  /** Скольким программам продукт вообще рекомендуется (балл не ниже порога). */
  recommendedFor: number
  /** Средний балл по программам, которым рекомендуется; null — никому. */
  averageScore: number | null
}

/**
 * По всему портфелю — «куда нести каждый продукт». Без `productId` — у каждого
 * продукта его самые сильные программы (не больше `perProduct`), вместе по баллу:
 * лучшая пара каждой программы на демо-данных почти везде одна и та же (ключевой
 * навык продукта — самый востребованный), и список из двадцати одинаковых строк
 * руководителю ничего не говорит. С `productId` — все программы, которым
 * рекомендуется этот продукт. У строки — `bestForProgram`: это ещё и лучший
 * продукт для самой программы. `reach` — сводка по продуктам за тот же проход.
 */
export function recommendForPortfolio(
  programs: readonly MatchProgram[],
  products: readonly MatchProduct[],
  context: MatchContext,
  productId?: string,
  perProduct: number = PRODUCT_MATCH.portfolioPerProduct,
): { items: ProductRecommendationDto[]; programsWithout: number; reach: ProductReach[] } {
  let programsWithout = 0
  const byProduct = new Map<string, ProductRecommendationDto[]>()
  const reach = new Map<string, ProductReach & { scoreSum: number }>(
    products.map((product) => [
      product.id,
      { productId: product.id, productName: product.name, bestFor: 0, recommendedFor: 0, averageScore: null, scoreSum: 0 },
    ]),
  )
  for (const program of programs) {
    const match = recommendForProgram(program, products, context).items
    const [first] = match
    if (!first) programsWithout += 1
    else reach.get(first.product.id)!.bestFor += 1
    for (const item of match) {
      const entry = reach.get(item.product.id)!
      entry.recommendedFor += 1
      entry.scoreSum += item.score
      const list = byProduct.get(item.product.id) ?? []
      list.push({ ...item, bestForProgram: item === first })
      byProduct.set(item.product.id, list)
    }
  }
  const items = productId
    ? [...(byProduct.get(productId) ?? [])]
    : [...byProduct.values()].flatMap((list) => [...list].sort(compareRecommendations).slice(0, perProduct))
  return {
    items: items.sort(compareRecommendations),
    programsWithout,
    reach: [...reach.values()]
      .map(({ scoreSum, ...entry }) => ({
        ...entry,
        averageScore: entry.recommendedFor > 0 ? Math.round(scoreSum / entry.recommendedFor) : null,
      }))
      .sort(
        (a, b) =>
          b.bestFor - a.bestFor || b.recommendedFor - a.recommendedFor || a.productName.localeCompare(b.productName, 'ru'),
      ),
  }
}

/**
 * Вывод одной фразой для общего списка: какой продукт чаще всего лучший; с выбранным
 * продуктом — скольким программам он рекомендуется и где сильнее всего.
 */
export function portfolioSummary(input: {
  reach: readonly ProductReach[]
  programsWithout: number
  product?: { name: string; items: readonly ProductRecommendationDto[] }
}): string {
  const { product } = input
  if (product) {
    const [top] = product.items
    if (!top) return `«${product.name}» не закрывает дефицитов ни одной действующей программы или уже подключён.`
    return (
      `«${product.name}» рекомендуется ${countWithNoun(product.items.length, ['программе', 'программам', 'программам'])}; ` +
      `сильнее всего — «${top.program.name}» (${top.program.universityName}), балл ${top.score}.`
    )
  }
  const withBest = input.reach.reduce((sum, row) => sum + row.bestFor, 0)
  const [leader] = input.reach
  if (!leader || withBest === 0) {
    return 'Подходящих пар нет: продукты не закрывают дефицитов программ или нет рыночных данных.'
  }
  const without =
    input.programsWithout > 0
      ? ` ${countWithNoun(input.programsWithout, ['программе', 'программам', 'программам'])} предложить нечего — их навыки уже закрыты или данных нет.`
      : ''
  return (
    `Чаще всего лучший вариант — «${leader.productName}»: для ${leader.bestFor} из ${countWithNoun(withBest, ['программы', 'программ', 'программ'])} с рекомендацией.` +
    without
  )
}

/** Вывод одной фразой для карточки программы или вуза. */
export function cardSummary(items: readonly ProductRecommendationDto[], scope: 'program' | 'university'): string {
  const [first] = items
  if (!first) {
    return scope === 'program'
      ? 'Предложить нечего: действующие продукты не закрывают дефицитов этой программы или уже подключены.'
      : 'Предложить нечего: продукты не закрывают дефицитов программ вуза или уже подключены.'
  }
  const where = scope === 'university' ? ` для программы «${first.program.name}»` : ''
  return `Лучший вариант — «${first.product.name}»${where}: закроет ${countWithNoun(first.closes.length, ['дефицитный навык', 'дефицитных навыка', 'дефицитных навыков'])}, балл ${first.score} из 100.`
}

export const PRODUCT_MATCH_METHOD =
  'Балл 0–100 — насколько продукт закрывает дефициты программы. Для каждого навыка продукта дефицит = спрос рынка минус покрытие программой (нет навыка — 0, базовый — 34, средний — 67, продвинутый — 100). ' +
  'Балл — средний дефицит по навыкам продукта с весом значимости навыка в продукте (ключевой 1, смежный 0,6, дополнительный 0,3); навык вне профиля направления — вполовину. ' +
  `Поправки: продукт уже есть у вуза по другой программе — минус ${PRODUCT_MATCH.sameUniversityPenalty}, связка с ним отменена за полгода — минус ${PRODUCT_MATCH.recentCancelPenalty}; уже подключённый продукт не предлагается. ` +
  'Уверенность — по полноте данных: сколько навыков записано у программы и по скольким навыкам продукта известен спрос. Обучения и ИИ в расчёте нет.'
