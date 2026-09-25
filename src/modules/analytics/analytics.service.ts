import { assertCan, can, universityScope } from '@/shared/auth/permissions'
import {
  DASHBOARD_PROBLEM_LIMIT,
  DASHBOARD_TOP_LIMIT,
  TREND_PERIOD_DAYS,
} from '@/shared/config/analytics.config'
import type { CurrentUser } from '@/shared/auth/current-user'
import type {
  DashboardMetricDto,
  MetricTrendDto,
  DashboardOverviewDto,
  ProblemCooperationDto,
  SkillMatchSummaryDto,
  TopProgramDto,
} from '@/shared/contracts/analytics'
import type { RecommendationDto } from '@/shared/contracts/recommendation'
import { daysBetween } from '@/shared/utils/date'
import { percent, round } from '@/shared/utils/number'
import * as skillsService from '@/modules/skills/skills.service'
import { toRecommendationDtos } from '@/modules/recommendations/recommendations.service'
import * as repo from './analytics.repo'
import { compareWithPast, isClosedOnTime, onTimePercent } from './trend'
import { aggregateUniversityRatings, calculateRatings, type RatingBounds, type RatingInput } from './rating'
import type { ProgramRatingDto, RankedProgramDto, UniversityRatingDto } from '@/shared/contracts/rating'
import type { CurrentUserStatsDto } from '@/shared/contracts/user'

/** Показатель без данных: значение null и явная пометка, а не ноль (решение 8). */
function noData(key: string, title: string, unit: string, explanation: string): DashboardMetricDto {
  return {
    key,
    title,
    value: null,
    unit,
    basis: 'none',
    explanation,
    period: null,
    source: null,
    isMock: false,
  }
}

function metric(
  key: string,
  title: string,
  value: number,
  unit: string,
  explanation: string,
  options: { basis?: 'actual' | 'estimate'; isMock?: boolean; trend?: MetricTrendDto | null } = {},
): DashboardMetricDto {
  return {
    key,
    title,
    value,
    unit,
    basis: options.basis ?? 'actual',
    explanation,
    period: null,
    source: 'Данные системы',
    isMock: options.isMock ?? false,
    ...(options.trend !== undefined ? { trend: options.trend } : {}),
  }
}

/** Сводка соответствия программ требованиям рынка для дашборда. */
async function buildSkillMatch(user: CurrentUser): Promise<SkillMatchSummaryDto> {
  const gaps = await skillsService.gaps(user, { limit: 1 })
  const total = gaps.summary.demanded

  // Нет рыночных данных — нет и счётчиков. Раньше рядом с «Нет данных» стояло
  // «0 навыков покрыто · 0 востребовано · 0 критических дефицитов»: отсутствие
  // данных читалось как отсутствие дефицитов (ANALYTICS_METHODOLOGY, раздел 3).
  if (total === 0) {
    return {
      coveragePercent: null,
      coveredSkills: null,
      demandedSkills: null,
      criticalGaps: null,
      period: gaps.period ?? '—',
      isMock: gaps.isMock,
    }
  }

  const covered = gaps.summary.covered
  return {
    coveragePercent: percent(covered, total),
    coveredSkills: covered,
    demandedSkills: total,
    criticalGaps: gaps.summary.critical,
    period: gaps.period ?? '—',
    isMock: gaps.isMock,
  }
}

/**
 * Сводка главной страницы (раздел 7.1 ТЗ).
 * У каждого показателя есть значение, единица, происхождение и признак демо-данных.
 */
export async function overview(user: CurrentUser): Promise<DashboardOverviewDto> {
  assertCan(user, 'ANALYTICS')

  const now = new Date()
  const scope = universityScope(user)

  const trendStart = new Date(now.getTime() - TREND_PERIOD_DAYS * 24 * 60 * 60 * 1000)

  const [
    cooperationCounts,
    activeCooperationsBefore,
    universitiesInWork,
    completedStages,
    cycles,
    programs,
    problemStages,
    problemStageTotal,
    logged,
    skillMatch,
    priorityRows,
    cooperationsAreMock,
    universitiesAreMock,
  ] = await Promise.all([
    repo.countCooperationsByStatus(scope),
    repo.countCooperationsOpenAt(scope, trendStart),
    repo.countUniversitiesInWork(scope),
    repo.findCompletedStagesWithDeadline(scope),
    repo.findCycleDurations(scope),
    repo.findProgramsForRating(scope, 200),
    repo.findProblemStages(scope, now, DASHBOARD_PROBLEM_LIMIT),
    repo.countProblemStages(scope, now),
    repo.countLoggedOperations(scope),
    buildSkillMatch(user),
    repo.findPriorityRecommendations(scope, DASHBOARD_TOP_LIMIT),
    repo.hasMockCooperations(scope),
    repo.hasMockUniversities(scope),
  ])

  // Одно число активных на показатель и на разбивку — они не могут разойтись.
  const activeCooperations = cooperationCounts.active

  const metrics: DashboardMetricDto[] = [
    metric(
      'activeCooperations',
      'Активные связи',
      activeCooperations,
      'связей',
      'Связки в статусах «Черновик» и «В работе»',
      {
        isMock: cooperationsAreMock,
        trend: compareWithPast(activeCooperations, activeCooperationsBefore),
      },
    ),
    metric(
      'universitiesInWork',
      'Вузы в работе',
      universitiesInWork,
      'вузов',
      'Вузы в статусах «В работе» и «Активен», кроме архивных',
      { isMock: universitiesAreMock },
    ),
  ]

  // Доля этапов, закрытых в срок.
  if (completedStages.length === 0) {
    metrics.push(
      noData(
        'stagesOnTimePercent',
        'Этапы, закрытые в срок',
        '%',
        'Нет данных: ещё нет завершённых этапов с установленным сроком',
      ),
    )
  } else {
    const onTimeShare = onTimePercent(completedStages)
    const onTime = completedStages.filter(isClosedOnTime).length
    // Тот же показатель на начало периода — по этапам, закрытым к тому дню.
    const onTimeShareBefore = onTimePercent(
      completedStages.filter((stage) => stage.completedAt && stage.completedAt <= trendStart),
    )
    metrics.push(
      metric(
        'stagesOnTimePercent',
        'Этапы, закрытые в срок',
        onTimeShare ?? 0,
        '%',
        `${onTime} из ${completedStages.length} завершённых этапов закрыты не позже срока ` +
          '(контрольный этап 14 не считается: он закрывается сам по остальным)',
        {
          isMock: completedStages.some((stage) => stage.cooperation.isMock),
          trend:
            onTimeShare === null || onTimeShareBefore === null
              ? null
              : compareWithPast(onTimeShare, onTimeShareBefore),
        },
      ),
    )
  }

  // Среднее время от первого контакта до начала занятий.
  if (cycles.length === 0) {
    metrics.push(
      noData(
        'avgDaysToClasses',
        'Среднее время до начала занятий',
        'дней',
        'Нет данных: ни в одной связке не заполнены первый контакт и дата начала занятий',
      ),
    )
  } else {
    const days = cycles.map((cycle) =>
      daysBetween(cycle.firstContactAt as Date, cycle.classesStartAt as Date),
    )
    const average = days.reduce((sum, value) => sum + value, 0) / days.length
    // Дата начала занятий бывает плановой: занятия ещё не начались. Такой срок —
    // оценка, а не факт, и помечается так же, как любой оценочный показатель (решение 8).
    const planned = cycles.filter((cycle) => (cycle.classesStartAt as Date) > now).length
    metrics.push(
      metric(
        'avgDaysToClasses',
        'Среднее время до начала занятий',
        round(average, 1),
        'дней',
        `Среднее по ${cycles.length} связкам, где заполнены первый контакт и начало занятий` +
          (planned > 0 ? `; в ${planned} из них начало занятий — плановая дата` : ''),
        {
          basis: planned > 0 ? 'estimate' : 'actual',
          isMock: cycles.some((cycle) => cycle.isMock),
        },
      ),
    )
  }

  // Операции на связку. Считается по журналу действий, а не по всем действиям пользователя.
  //
  // Пустой журнал — это «ещё не знаем», а не «усилий не требуется». Показать здесь ноль
  // значило бы соврать ровно в ту сторону, в которую системе выгодно (решение 8).
  if (logged.cooperations === 0 || logged.operations === 0) {
    metrics.push(
      noData(
        'operationsPerCooperation',
        'Операций на связку',
        'операций',
        logged.cooperations === 0
          ? 'Нет данных: связок пока нет'
          : 'Нет данных: действия ещё не записывались в журнал',
      ),
    )
  } else {
    metrics.push(
      metric(
        'operationsPerCooperation',
        'Операций на связку',
        round(logged.operations / logged.cooperations, 1),
        'операций',
        `Учитываются только действия, попавшие в журнал: ${logged.operations} на ${logged.cooperations} связок`,
        { basis: 'estimate', isMock: cooperationsAreMock },
      ),
    )
  }

  const ratings = calculateRatings(
    programs.map((program) => ({
      programId: program.id,
      applicationCount: program.applicationCount,
      studentCount: program.studentCount,
      groupCount: program.groupCount,
      metricsSource: program.metricsSource,
    })),
    await ratingBoundsFromDatabase(scope),
  )

  const topPrograms: TopProgramDto[] = programs
    .map((program) => {
      const rating = ratings.get(program.id)
      return {
        programId: program.id,
        programName: program.name,
        universityId: program.university.id,
        universityName: program.university.name,
        universityShortName: program.university.shortName,
        score: rating?.score ?? null,
        basis: rating?.basis ?? 'none',
        factors:
          rating?.factors.map((factor) => ({
            key: factor.key,
            title: factor.title,
            value: factor.value,
            weight: factor.weight,
            contribution: factor.contribution,
          })) ?? [],
      }
    })
    .filter((program) => program.score !== null)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, DASHBOARD_TOP_LIMIT)

  const problemCooperations: ProblemCooperationDto[] = problemStages.map((stage) => {
    const overdueDays =
      stage.deadline && stage.status !== 'BLOCKED' ? daysBetween(stage.deadline, now) : null
    return {
      cooperationId: stage.cooperation.id,
      universityName: stage.cooperation.university.name,
      universityShortName: stage.cooperation.university.shortName,
      programName: stage.cooperation.program.name,
      reason:
        stage.status === 'BLOCKED'
          ? `Этап заблокирован: ${stage.blockingReason ?? 'причина не указана'}`
          : overdueDays === null || overdueDays === 0
            ? 'Срок этапа вышел сегодня'
            : `Этап просрочен на ${overdueDays} дн.`,
      stageId: stage.id,
      stageNumber: stage.stageNumber,
      stageTitle: stage.title,
      daysOverdue: overdueDays,
    }
  })

  const priorityActions: RecommendationDto[] = await toRecommendationDtos(priorityRows)

  return {
    metrics,
    cooperationCounts,
    topPrograms,
    problemCooperations,
    problemStageTotal,
    priorityActions,
    skillMatch,
    generatedAt: now.toISOString(),
    containsMockData:
      skillMatch.isMock ||
      programs.some((program) => program.isMock) ||
      metrics.some((item) => item.isMock),
  }
}


// Тип живёт в контрактах: его читает фронт. Здесь — только реэкспорт,
// чтобы существующие импорты из модуля не ломались.
export type { RankedProgramDto } from '@/shared/contracts/rating'

/**
 * Рейтинг программ с раскрытием вклада каждого показателя (концепция, решение 7).
 * Баллы нормируются внутри выборки, поэтому сравнивать их можно только внутри одного ответа.
 */
export async function programRating(
  user: CurrentUser,
  options: { limit: number },
): Promise<{ data: RankedProgramDto[]; total: number }> {
  assertCan(user, 'ANALYTICS')

  const ratingScope = universityScope(user)
  const programs = await repo.findProgramsForRating(ratingScope, 500)
  const ratings = calculateRatings(
    programs.map((program) => ({
      programId: program.id,
      applicationCount: program.applicationCount,
      studentCount: program.studentCount,
      groupCount: program.groupCount,
      metricsSource: program.metricsSource,
    })),
    await ratingBoundsFromDatabase(ratingScope),
  )

  const ranked: RankedProgramDto[] = programs
    .map((program) => {
      const rating = ratings.get(program.id)
      return {
        programId: program.id,
        programName: program.name,
        universityId: program.university.id,
        universityName: program.university.name,
        score: rating?.score ?? null,
        basis: rating?.basis ?? 'none',
        explanation: rating?.explanation ?? 'Нет данных',
        factors: rating?.factors ?? [],
        isMock: program.isMock,
      }
    })
    // Программы без данных не выбрасываются: они уходят в конец с пометкой «Нет данных».
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1))

  // Всего — по базе, а не по срезу: срез ограничен пятьюстами, и на шести тысячах
  // программ страница писала «Показаны 20 из 500».
  return {
    data: ranked.slice(0, options.limit),
    total: await repo.countProgramsForRating(ratingScope),
  }
}

/**
 * Рейтинги только перечисленных вузов — для страницы реестра.
 *
 * Читает программы одной страницы вместо всей базы, а шкалу берёт агрегатом
 * по всем действующим программам. Баллы получаются те же, что при полном
 * расчёте: нормирование от выборки не зависит.
 *
 * Полный расчёт остаётся нужен там, где по рейтингу фильтруют или сортируют:
 * чтобы отобрать вузы по баллу, балл нужен у каждого.
 */
export async function universityRatingsForPage(
  user: CurrentUser,
  universityIds: readonly string[],
): Promise<Map<string, UniversityRatingDto>> {
  assertCan(user, 'ANALYTICS')
  if (universityIds.length === 0) return new Map()

  const scope = universityScope(user)
  const [bounds, programs] = await Promise.all([
    repo.findRatingBounds(scope),
    repo.findProgramsOfUniversities(universityIds, scope),
  ])

  const knownBounds: RatingBounds = new Map([
    ['applicationCount', toBound(bounds._min.applicationCount, bounds._max.applicationCount)],
    ['studentCount', toBound(bounds._min.studentCount, bounds._max.studentCount)],
    ['groupCount', toBound(bounds._min.groupCount, bounds._max.groupCount)],
  ])

  const ratings = calculateRatings(
    programs.map((program) => ({
      programId: program.id,
      applicationCount: program.applicationCount,
      studentCount: program.studentCount,
      groupCount: program.groupCount,
      metricsSource: program.metricsSource,
    })),
    knownBounds,
  )

  return aggregateUniversityRatings(
    programs.map((program) => ({
      programId: program.id,
      programName: program.name,
      universityId: program.universityId,
    })),
    ratings,
  )
}

/**
 * Границы нормирования по всей базе — одним агрегатом.
 *
 * Рейтинг считается по срезу программ (двести на дашборде, пятьсот в списке),
 * но шкала обязана быть общей. Иначе балл зависит от того, попала ли программа
 * в срез: на выборке из 260 программ p150 получала 61,3 при полном расчёте
 * и 75,3 при срезе в 200 строк. Это делает рейтинг необъяснимым — то, чего
 * раздел 10 ТЗ прямо требует избегать.
 */
async function ratingBoundsFromDatabase(scope: { universityId?: string }): Promise<RatingBounds> {
  const bounds = await repo.findRatingBounds(scope)
  return new Map([
    ['applicationCount', toBound(bounds._min.applicationCount, bounds._max.applicationCount)],
    ['studentCount', toBound(bounds._min.studentCount, bounds._max.studentCount)],
    ['groupCount', toBound(bounds._min.groupCount, bounds._max.groupCount)],
  ])
}

/** Агрегат СУБД отдаёт null, когда заполненных значений нет — это «шкалы нет». */
function toBound(min: number | null, max: number | null): { min: number; max: number } | null {
  return min === null || max === null ? null : { min, max }
}

/**
 * Рейтинги всех вузов в области видимости пользователя (пункт 7.2 ТЗ).
 *
 * Возвращает карту, а не список: используется реестром вузов для показа,
 * фильтрации и сортировки по рейтингу.
 *
 * Нормирование идёт по всей выборке программ сразу, поэтому вызывать функцию
 * нужно один раз на запрос, а не по вузу.
 */
export async function universityRatings(
  user: CurrentUser,
): Promise<Map<string, UniversityRatingDto>> {
  assertCan(user, 'ANALYTICS')

  // Здесь выборка полная — границы по ней совпадают с границами по базе.
  const programs = await repo.findProgramsForUniversityRating(universityScope(user))
  const ratings = calculateRatings(
    programs.map((program) => ({
      programId: program.id,
      applicationCount: program.applicationCount,
      studentCount: program.studentCount,
      groupCount: program.groupCount,
      metricsSource: program.metricsSource,
    })),
  )

  return aggregateUniversityRatings(
    programs.map((program) => ({
      programId: program.id,
      programName: program.name,
      universityId: program.universityId,
    })),
    ratings,
  )
}

/**
 * Рейтинг одной программы — для её карточки.
 *
 * Шкала та же, что в рейтинге программ и вузов: границы — агрегат по всем
 * действующим программам. Иначе у одной программы в карточке и в рейтинге
 * стояли бы разные баллы.
 *
 * Представителю вуза рейтинг не показывается — как и в реестре вузов:
 * null, а не отказ, потому что саму карточку программы он открывать вправе.
 */
export async function ratingOfProgram(
  user: CurrentUser,
  program: RatingInput & { isActive: boolean },
): Promise<ProgramRatingDto | null> {
  const ratings = await ratingsOfPrograms(user, [program])
  return ratings?.get(program.programId) ?? null
}

/**
 * Рейтинги набора программ — для карточки и для выгрузки реестра.
 *
 * Один расчёт на оба места: балл в файле обязан совпадать с баллом на экране,
 * а шкала — агрегат по всем действующим программам, как в `ratingOfProgram`.
 * null — рейтинг роли недоступен (представитель вуза).
 */
export async function ratingsOfPrograms(
  user: CurrentUser,
  programs: ReadonlyArray<RatingInput & { isActive: boolean }>,
): Promise<Map<string, ProgramRatingDto> | null> {
  if (!can(user, 'ANALYTICS')) return null

  const result = new Map<string, ProgramRatingDto>()
  for (const program of programs) {
    if (program.isActive) continue
    result.set(program.programId, {
      programId: program.programId,
      score: null,
      basis: 'none',
      explanation: 'Программа не действует и в рейтинге не участвует',
      factors: [],
    })
  }

  const active = programs.filter((program) => program.isActive)
  if (active.length === 0) return result

  const bounds = await ratingBoundsFromDatabase(universityScope(user))
  for (const [programId, rating] of calculateRatings(active, bounds)) result.set(programId, rating)
  return result
}

/**
 * Личная статистика — блок «Статистика» личного кабинета.
 *
 * Считается по связкам и этапам, где пользователь — ответственный. Прав на
 * аналитику не требует: это его собственная работа, а не сводка по чужим.
 */
export async function personalStats(user: CurrentUser): Promise<CurrentUserStatsDto> {
  const now = new Date()
  const [cooperations, completed, overdue] = await Promise.all([
    repo.findActiveCooperationsOf(user.id),
    repo.findCompletedStagesWithDeadlineOf(user.id),
    repo.countOverdueStagesOf(user.id, now),
  ])

  const onTime = completed.filter(
    (stage) => stage.completedAt && stage.deadline && stage.completedAt <= stage.deadline,
  ).length

  return {
    activeCooperations: cooperations.length,
    universitiesInWork: new Set(cooperations.map((item) => item.universityId)).size,
    programsManaged: new Set(cooperations.map((item) => item.programId)).size,
    stagesOnTimePercent: percent(onTime, completed.length),
    stagesCompletedWithDeadline: completed.length,
    overdueStages: overdue,
    containsMockData: cooperations.some((item) => item.isMock),
    generatedAt: now.toISOString(),
  }
}
