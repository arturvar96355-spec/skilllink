import { z } from '@/shared/zod'
import { assertCan, can, isReviewerAllowed } from '@/shared/auth/permissions'
import type { CurrentUser } from '@/shared/auth/current-user'
import { PRODUCT_MATCH } from '@/shared/config/analytics.config'
import type {
  ProductRecommendationDto,
  ProductRecommendationScope,
  ProductRecommendationsDto,
} from '@/shared/contracts/product-recommendation'
import { conflict, forbidden, notFound } from '@/shared/http/errors'
import * as skillsRepo from '@/modules/skills/skills.repo'
import * as repo from './product-match.repo'
import {
  PRODUCT_MATCH_METHOD,
  buildDemand,
  buildProfiles,
  cardSummary,
  evaluatePair,
  portfolioSummary,
  recommendForPortfolio,
  recommendForProgram,
  recommendForUniversity,
  type MatchContext,
  type MatchProgram,
} from './product-match.rules'

/**
 * Рекомендации продуктов (решение 223): что предложить программе, вузу и по всему
 * портфелю. Считается на лету, в базе ничего не хранится. Право — аналитика:
 * представителю вуза 403 (он не видит рекомендаций, решение 9), эксперту — чтение.
 */

export const cardQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(10).default(PRODUCT_MATCH.cardLimit),
})

export const portfolioQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(PRODUCT_MATCH.portfolioMaxLimit).default(PRODUCT_MATCH.portfolioLimit),
  universityId: z.string().trim().min(1).optional(),
  /** Все программы, которым рекомендуется этот продукт, — вместо лучшей пары каждой программы. */
  productId: z.string().trim().min(1).optional(),
})

export type CardQuery = z.infer<typeof cardQuerySchema>
export type PortfolioQuery = z.infer<typeof portfolioQuerySchema>

/**
 * Черновик письма — текст, который никуда не уходит и в базе не остаётся (только
 * запись в журнале). Поэтому эксперту (решение 147) он открыт: это чтение. Роль —
 * та же, что пишет вузам (WRITE): наблюдатель и аналитик от имени ИТ-Школы не пишут.
 */
export function canDraftOfferLetter(user: CurrentUser): boolean {
  return can(user, 'WRITE') && can(user, 'ANALYTICS')
}

export function assertCanDraftOfferLetter(user: CurrentUser): void {
  if (!canDraftOfferLetter(user)) throw forbidden('Черновик письма вузу доступен тем, кто ведёт работу с вузами')
}

/** Создать связку — изменение данных: эксперту не показывается и не разрешается. */
function canCreateCooperation(user: CurrentUser): boolean {
  return can(user, 'WRITE') && (!user.isReviewer || isReviewerAllowed('WRITE'))
}

function actionsFor(user: CurrentUser): ProductRecommendationsDto['actions'] {
  return { canDraftLetter: canDraftOfferLetter(user), canCreateCooperation: canCreateCooperation(user) }
}

interface LoadedContext {
  context: MatchContext
  period: string | null
  products: Awaited<ReturnType<typeof repo.findActiveProducts>>
  productsWithoutSkills: string[]
  activePrograms: MatchProgram[]
}

/** Спрос последнего периода, продукты, связки и профили направлений — один раз на запрос. */
async function loadContext(now: Date): Promise<LoadedContext> {
  const period = await skillsRepo.latestPeriod()
  const [demandRows, allProducts, cooperations, activePrograms] = await Promise.all([
    period ? skillsRepo.findDemandForPeriod(period) : Promise.resolve([]),
    repo.findActiveProducts(),
    repo.findCooperations(),
    repo.findActivePrograms(),
  ])
  const { demand, isMock } = buildDemand(demandRows)
  return {
    context: { demand, isMock, profiles: buildProfiles(activePrograms), cooperations, now },
    period,
    products: allProducts.filter((product) => product.skills.length > 0),
    productsWithoutSkills: allProducts.filter((product) => product.skills.length === 0).map((product) => product.name),
    activePrograms,
  }
}

function response(
  user: CurrentUser,
  scope: ProductRecommendationScope,
  loaded: LoadedContext,
  items: ProductRecommendationDto[],
  limit: number,
  extra: Pick<ProductRecommendationsDto, 'excluded' | 'summary'>,
): ProductRecommendationsDto {
  const noMarket = loaded.period === null || loaded.context.demand.size === 0
  return {
    scope,
    period: loaded.period,
    isMock: loaded.context.isMock,
    items: items.slice(0, limit),
    total: items.length,
    excluded: extra.excluded,
    productsWithoutSkills: loaded.productsWithoutSkills,
    summary: noMarket ? 'Нет рыночных данных о спросе — рекомендовать продукты не на чем.' : extra.summary,
    method: PRODUCT_MATCH_METHOD,
    actions: actionsFor(user),
  }
}

/** Что предложить программе — для блока в её карточке. */
export async function forProgram(
  user: CurrentUser,
  programId: string,
  query: CardQuery,
  now: Date = new Date(),
): Promise<ProductRecommendationsDto> {
  assertCan(user, 'ANALYTICS')
  const program = await repo.findProgram(programId)
  if (!program) throw notFound('Программа не найдена')
  const loaded = await loadContext(now)
  const { items, excluded } = recommendForProgram(program, loaded.products, loaded.context)
  return response(user, 'program', loaded, items, query.limit, { excluded, summary: cardSummary(items, 'program') })
}

/** Что предложить вузу — по всем его действующим программам, продукт один раз. */
export async function forUniversity(
  user: CurrentUser,
  universityId: string,
  query: CardQuery,
  now: Date = new Date(),
): Promise<ProductRecommendationsDto> {
  assertCan(user, 'ANALYTICS')
  const university = await repo.findUniversity(universityId)
  if (!university) throw notFound('Вуз не найден')
  const loaded = await loadContext(now)
  const programs = loaded.activePrograms.filter((program) => program.universityId === universityId)
  const { items } = recommendForUniversity(programs, loaded.products, loaded.context)
  const summary =
    programs.length === 0
      ? 'У вуза нет действующих программ — предлагать не к чему.'
      : cardSummary(items, 'university')
  // Отказы по каждой паре программ вуза — слишком длинный список для карточки: не отдаём.
  return response(user, 'university', loaded, items, query.limit, { excluded: [], summary })
}

/** Общий список по портфелю: самые сильные программы каждого продукта, от сильной пары к слабой. */
export async function forPortfolio(
  user: CurrentUser,
  query: PortfolioQuery,
  now: Date = new Date(),
): Promise<ProductRecommendationsDto> {
  assertCan(user, 'ANALYTICS')
  const loaded = await loadContext(now)
  const programs = query.universityId
    ? loaded.activePrograms.filter((program) => program.universityId === query.universityId)
    : loaded.activePrograms
  const product = query.productId ? loaded.products.find((item) => item.id === query.productId) : undefined
  if (query.productId && !product) throw notFound('Действующий IT-продукт с навыками не найден')
  const { items, programsWithout, reach } = recommendForPortfolio(programs, loaded.products, loaded.context, product?.id)
  return {
    ...response(user, 'portfolio', loaded, items, query.limit, {
      excluded: [],
      summary: portfolioSummary({
        reach,
        programsWithout,
        ...(product ? { product: { name: product.name, items } } : {}),
      }),
    }),
    reach,
    programCount: programs.length,
  }
}

/**
 * Одна пара — для черновика письма. Продукт, который программе не предлагается
 * (уже подключён, не закрывает дефицитов), — 409 с причиной: письмо о нём
 * убеждало бы вуз в том, чего данные не говорят.
 */
export async function pairFor(
  user: CurrentUser,
  programId: string,
  productId: string,
  now: Date = new Date(),
): Promise<{ recommendation: ProductRecommendationDto; period: string | null; isMock: boolean }> {
  assertCan(user, 'ANALYTICS')
  const program = await repo.findProgram(programId)
  if (!program) throw notFound('Программа не найдена')
  const loaded = await loadContext(now)
  const product = loaded.products.find((item) => item.id === productId)
  if (!product) throw notFound('Действующий IT-продукт с навыками не найден')
  const result = evaluatePair(program, product, loaded.context)
  if (!result.recommendation) {
    const reason = result.excluded?.reason ?? 'нет данных'
    throw conflict(`Продукт «${product.name}» этой программе не рекомендуется: ${reason.charAt(0).toLowerCase()}${reason.slice(1)}`)
  }
  return { recommendation: result.recommendation, period: loaded.period, isMock: loaded.context.isMock }
}

/** Связки вуза с продуктом, которые идут сейчас, — для строки «уже работаем» в письме. */
export async function openCooperationsOf(universityId: string) {
  return repo.findCooperations({ universityId, status: { in: ['DRAFT', 'ACTIVE', 'PAUSED'] }, productId: { not: null } })
}

export const findPrimaryContact = repo.findPrimaryContact
