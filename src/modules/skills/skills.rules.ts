import { SKILL_GAP, SKILL_PROFILE } from '@/shared/config/analytics.config'
import type {
  ConfidenceLevel,
  DataOrigin,
  ProductSkillRelevance,
  SkillImportance,
  SkillLevel,
} from '@/shared/contracts/enums'
import { conflict, type AppError } from '@/shared/http/errors'
import { normalize, outOf100, range, round } from '@/shared/utils/number'
import { countWithNoun } from '@/shared/utils/text'

/** Покрытие навыка программой по уровню освоения. Навыка нет — покрытие 0. */
export function coverageByLevel(level: SkillLevel | null): number {
  if (!level) return 0
  return SKILL_GAP.levelCoverage[level]
}

/**
 * Нормирует спрос к 0..1 по всей выборке периода.
 * Возвращает функцию, чтобы нормировать каждую строку одним и тем же масштабом.
 */
export function demandNormalizer(values: number[]): (value: number | null) => number | null {
  const bounds = range(values)
  if (!bounds) return () => null
  return (value) => (value === null ? null : round(normalize(value, bounds.min, bounds.max), 3))
}

export interface GapCalculation {
  coverage: number
  gap: number
  isCritical: boolean
  explanation: string
}

/**
 * Дефицит навыка: насколько спрос рынка превышает покрытие программой.
 * Если спроса нет, дефицит не считается — это не ноль, а отсутствие данных.
 */
export function calculateGap(
  demandNormalized: number | null,
  level: SkillLevel | null,
  skillName: string,
): GapCalculation {
  const coverage = coverageByLevel(level)

  if (demandNormalized === null) {
    return {
      coverage,
      gap: 0,
      isCritical: false,
      explanation: `Нет данных о востребованности навыка «${skillName}» за выбранный период`,
    }
  }

  const gap = round(Math.max(0, demandNormalized - coverage), 3)
  const isDemanded = demandNormalized >= SKILL_GAP.demandThreshold
  const isCritical = SKILL_GAP.criticalWhenMissing && isDemanded && coverage === 0

  const explanation = isCritical
    ? `Навык «${skillName}» востребован рынком (${outOf100(demandNormalized)} из 100), но в программе отсутствует`
    : `Спрос ${outOf100(demandNormalized)} из 100, покрытие программой ${outOf100(coverage)} из 100`

  return { coverage, gap, isCritical, explanation }
}

/**
 * Конец периода в миллисекундах: «2026-Q1» — 31 марта, «2026-09» — 30 сентября.
 * `null` — формат не распознан.
 */
export function periodEnd(period: string): number | null {
  const quarter = /^(\d{4})-Q([1-4])$/.exec(period)
  if (quarter) return Date.UTC(Number(quarter[1]), Number(quarter[2]) * 3, 0)
  const month = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(period)
  if (month) return Date.UTC(Number(month[1]), Number(month[2]), 0)
  return null
}

/**
 * Самый свежий период — по календарю, а не по алфавиту.
 *
 * Периоды бывают кварталами и месяцами (схема MarketDemand). Сортировка строк
 * поставила бы «2026-Q1» после «2026-09»: буква Q в таблице символов идёт после
 * цифр, и дефициты с рекомендациями считались бы по данным полугодовой давности.
 */
export function latestOfPeriods(periods: readonly string[]): string | null {
  let best: string | null = null
  let bestEnd = -Infinity
  for (const period of periods) {
    const end = periodEnd(period) ?? -Infinity
    if (best === null || end > bestEnd || (end === bestEnd && period > best)) {
      best = period
      bestEnd = end
    }
  }
  return best
}

/** Федеральный замер спроса — значение региона по умолчанию (схема MarketDemand). */
export const FEDERAL_REGION = 'Россия'

/**
 * Один замер спроса на навык за период.
 *
 * Замеров на навык бывает несколько: по регионам и источникам (уникальный ключ —
 * навык, период, источник, регион). Если считать дефицит по каждой строке, навык
 * дважды попадёт в список дефицитов, покрытие на главной учтёт его дважды,
 * а рекомендации по двум строкам одного навыка перезапишут друг друга.
 * Берётся федеральный замер, а без него — наибольший из региональных.
 */
export function demandPerSkill<T extends { skillId: string; value: number; region: string }>(
  rows: readonly T[],
): T[] {
  const bySkill = new Map<string, T>()
  for (const row of rows) {
    const current = bySkill.get(row.skillId)
    if (!current) {
      bySkill.set(row.skillId, row)
      continue
    }
    const currentFederal = current.region === FEDERAL_REGION
    const rowFederal = row.region === FEDERAL_REGION
    if ((rowFederal && !currentFederal) || (rowFederal === currentFederal && row.value > current.value)) {
      bySkill.set(row.skillId, row)
    }
  }
  return [...bySkill.values()]
}

/** Что преподают программы одной укрупнённой группы направлений (решение 98). */
export interface DirectionProfile {
  /** Первые две цифры кода направления: «09». */
  group: string
  skillIds: ReadonlySet<string>
  categories: ReadonlySet<string>
}

/** Укрупнённая группа направлений по коду «09.03.04» → «09». Нет кода — нет группы. */
export function directionGroup(code: string | null | undefined): string | null {
  const match = /^(\d{2})\./.exec(code?.trim() ?? '')
  return match ? match[1]! : null
}

function isExactMatchCategory(category: string): boolean {
  return (SKILL_PROFILE.exactMatchCategories as readonly string[]).includes(category)
}

/**
 * Навык в профиле программы: его преподаёт кто-то из группы направлений, либо —
 * кроме языков программирования — навыки той же области.
 */
export function isInProfile(
  skill: { id: string; category: string },
  profile: DirectionProfile,
): boolean {
  if (profile.skillIds.has(skill.id)) return true
  if (isExactMatchCategory(skill.category)) return false
  return profile.categories.has(skill.category)
}

/** Пояснение к дефициту вне профиля — дописывается к обычному объяснению. */
export function outOfProfileNote(category: string, group: string): string {
  const what = isExactMatchCategory(category) ? 'этот язык' : `навыки области «${category}»`
  return (
    `Вне профиля: ни одна программа группы направлений ${group} в системе не преподаёт ${what}, ` +
    'дефицит может быть не про эту программу'
  )
}

// ─────────────── Справочник навыков: уникальность, объединение, удаление ────────────
// Решение 107. Правила — чистыми функциями: сервис собирает факты, репозиторий пишет.

/**
 * Ключ сравнения названий: без учёта регистра и пробелов.
 *
 * «Machine Learning», «machine learning» и «MachineLearning» — один навык.
 * Пробелы убираются все, а не только по краям: дубль, заведённый с пробелом
 * внутри, так же расщепляет аналитику, как дубль в другом регистре. NFKC сводит
 * вместе знаки, которые выглядят одинаково (неразрывный пробел, «полноширинные» буквы).
 */
export function skillNameKey(name: string): string {
  return name.normalize('NFKC').toLocaleLowerCase('ru').replace(/\s+/gu, '')
}

/** Навык с тем же ключом названия. `excludeId` — сам изменяемый навык: своё имя не дубль. */
export function findNameClash<T extends { id: string; name: string }>(
  name: string,
  existing: readonly T[],
  excludeId?: string,
): T | null {
  const key = skillNameKey(name)
  return existing.find((row) => row.id !== excludeId && skillNameKey(row.name) === key) ?? null
}

export function duplicateSkillConflict(name: string, existingName: string): AppError {
  const same = name === existingName
  return conflict(
    same
      ? `Навык «${name}» уже есть в справочнике.`
      : `Навык «${name}» совпадает с «${existingName}» без учёта регистра и пробелов. ` +
          'Если это один навык — выберите его, если разные — назовите иначе.',
    [{ field: 'name', message: `Навык с таким названием уже есть: «${existingName}»` }],
  )
}

const LEVEL_RANK: Record<SkillLevel, number> = { BASIC: 1, INTERMEDIATE: 2, ADVANCED: 3 }
const IMPORTANCE_RANK: Record<SkillImportance, number> = { LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 }
const CONFIDENCE_RANK: Record<ConfidenceLevel, number> = { LOW: 1, MEDIUM: 2, HIGH: 3 }
const RELEVANCE_RANK: Record<ProductSkillRelevance, number> = { OPTIONAL: 1, RELATED: 2, CORE: 3 }

const stronger = <T extends string>(rank: Record<T, number>, a: T, b: T): T => (rank[b] > rank[a] ? b : a)

export interface ProgramSkillLink {
  id: string
  programId: string
  level: SkillLevel
  importance: SkillImportance
  source: DataOrigin
  confidence: ConfidenceLevel | null
  comment: string | null
}

export interface ProductSkillLink {
  id: string
  productId: string
  relevance: ProductSkillRelevance
}

export interface DemandLink {
  id: string
  period: string
  source: string
  region: string
  value: number
  unit: string
  confidence: ConfidenceLevel
  isMock: boolean
  dataSourceId: string | null
}

export interface RecommendationLink {
  id: string
  ruleKey: string
}

export interface SkillLinks {
  programs: ProgramSkillLink[]
  products: ProductSkillLink[]
  demand: DemandLink[]
  recommendations: RecommendationLink[]
}

/**
 * Одна программа учит и дублю, и целевому навыку — остаётся одна связь, более сильная
 * по каждому признаку: уровень, важность и уверенность — наибольшие; происхождение —
 * от связи с более высоким уровнем (при равном — целевой); комментарий — целевой,
 * а если его нет — дубля. Покрытие не падает: дефицит по навыку не появится там,
 * где его не было ни у одного из двух.
 */
export function combineProgramLinks(
  target: ProgramSkillLink,
  duplicate: ProgramSkillLink,
): Omit<ProgramSkillLink, 'id' | 'programId'> {
  const duplicateLeads = LEVEL_RANK[duplicate.level] > LEVEL_RANK[target.level]
  const confidence =
    target.confidence && duplicate.confidence
      ? stronger(CONFIDENCE_RANK, target.confidence, duplicate.confidence)
      : (target.confidence ?? duplicate.confidence)
  return {
    level: stronger(LEVEL_RANK, target.level, duplicate.level),
    importance: stronger(IMPORTANCE_RANK, target.importance, duplicate.importance),
    source: duplicateLeads ? duplicate.source : target.source,
    confidence,
    comment: target.comment ?? duplicate.comment,
  }
}

/** Продукт даёт оба — остаётся более сильная значимость: ключевой > смежный > дополнительный. */
export function combineRelevance(
  target: ProductSkillRelevance,
  duplicate: ProductSkillRelevance,
): ProductSkillRelevance {
  return stronger(RELEVANCE_RANK, target, duplicate)
}

const demandKey = (row: Pick<DemandLink, 'period' | 'source' | 'region'>) =>
  `${row.period}\u0000${row.source}\u0000${row.region}`

export interface SkillMergePlan {
  programs: {
    /** Связи дубля, которые просто переходят на целевой навык. */
    move: string[]
    /** Программа учит обоим: целевая связь получает `data`, связь дубля удаляется. */
    combine: Array<{ targetId: string; duplicateId: string; data: Omit<ProgramSkillLink, 'id' | 'programId'> }>
  }
  products: {
    move: string[]
    combine: Array<{ targetId: string; duplicateId: string; relevance: ProductSkillRelevance }>
  }
  demand: {
    move: string[]
    /**
     * Замер того же периода, источника и региона есть у обоих — остаётся максимум.
     * `replaceWith` — замер дубля больше: его значение переписывается в целевую строку.
     * Сумма была бы завышением: одна вакансия с «ML» и «Machine Learning» посчиталась бы дважды.
     */
    combine: Array<{ targetId: string; duplicateId: string; replaceWith: DemandLink | null }>
  }
  recommendations: {
    move: string[]
    /** У целевого навыка уже есть рекомендация того же правила — дубль удаляется. */
    drop: string[]
  }
}

/** План объединения дубля в целевой навык. Сам ничего не пишет — это делает репозиторий. */
export function planSkillMerge(target: SkillLinks, duplicate: SkillLinks): SkillMergePlan {
  const programByTarget = new Map(target.programs.map((row) => [row.programId, row]))
  const productByTarget = new Map(target.products.map((row) => [row.productId, row]))
  const demandByTarget = new Map(target.demand.map((row) => [demandKey(row), row]))
  const targetRules = new Set(target.recommendations.map((row) => row.ruleKey))

  const plan: SkillMergePlan = {
    programs: { move: [], combine: [] },
    products: { move: [], combine: [] },
    demand: { move: [], combine: [] },
    recommendations: { move: [], drop: [] },
  }

  for (const row of duplicate.programs) {
    const existing = programByTarget.get(row.programId)
    if (!existing) plan.programs.move.push(row.id)
    else plan.programs.combine.push({ targetId: existing.id, duplicateId: row.id, data: combineProgramLinks(existing, row) })
  }
  for (const row of duplicate.products) {
    const existing = productByTarget.get(row.productId)
    if (!existing) plan.products.move.push(row.id)
    else {
      plan.products.combine.push({
        targetId: existing.id,
        duplicateId: row.id,
        relevance: combineRelevance(existing.relevance, row.relevance),
      })
    }
  }
  for (const row of duplicate.demand) {
    const existing = demandByTarget.get(demandKey(row))
    if (!existing) plan.demand.move.push(row.id)
    else {
      plan.demand.combine.push({
        targetId: existing.id,
        duplicateId: row.id,
        replaceWith: row.value > existing.value ? row : null,
      })
    }
  }
  for (const row of duplicate.recommendations) {
    if (targetRules.has(row.ruleKey)) plan.recommendations.drop.push(row.id)
    else plan.recommendations.move.push(row.id)
  }
  return plan
}

export interface SkillUsage {
  programs: number
  products: number
  demand: number
  recommendations: number
}

export function isSkillUsed(usage: SkillUsage): boolean {
  return usage.programs + usage.products + usage.demand + usage.recommendations > 0
}

/**
 * Почему навык нельзя удалить: он где-то используется. Удаление каскадом стёрло бы
 * связи программ и продуктов и рыночные замеры — покрытие и дефициты изменились бы
 * молча. Дубль убирается объединением, неиспользуемый — удалением.
 */
export function skillInUseMessage(name: string, usage: SkillUsage): string {
  const parts = [
    usage.programs > 0 ? `в ${countWithNoun(usage.programs, ['программе', 'программах', 'программах'])}` : null,
    usage.products > 0 ? `в ${countWithNoun(usage.products, ['IT-продукте', 'IT-продуктах', 'IT-продуктах'])}` : null,
    usage.demand > 0
      ? `в ${countWithNoun(usage.demand, ['рыночном показателе', 'рыночных показателях', 'рыночных показателях'])}`
      : null,
    usage.recommendations > 0
      ? `в ${countWithNoun(usage.recommendations, ['рекомендации', 'рекомендациях', 'рекомендациях'])}`
      : null,
  ].filter((part): part is string => part !== null)
  return (
    `Навык «${name}» используется: ${parts.join(', ')}. Удалить можно только неиспользуемый навык — ` +
    'объедините его с другим или уберите из программ и продуктов.'
  )
}
