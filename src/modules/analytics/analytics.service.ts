import { assertCan, universityScope } from '@/shared/auth/permissions'
import { DASHBOARD_TOP_LIMIT } from '@/shared/config/analytics.config'
import type { CurrentUser } from '@/shared/auth/current-user'
import type {
  DashboardMetricDto,
  DashboardOverviewDto,
  ProblemCooperationDto,
  SkillMatchSummaryDto,
  TopProgramDto,
} from '@/shared/contracts/analytics'
import type { RecommendationDto } from '@/shared/contracts/recommendation'
import { daysBetween } from '@/shared/utils/date'
import { percent, round } from '@/shared/utils/number'
import * as skillsService from '@/modules/skills/skills.service'
import { toRecommendationDto } from '@/modules/recommendations/recommendations.service'
import * as repo from './analytics.repo'
import { calculateRatings } from './rating'
import type { ProgramRatingDto } from '@/shared/contracts/rating'

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
  options: { basis?: 'actual' | 'estimate'; isMock?: boolean } = {},
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
  }
}

/** Сводка соответствия программ требованиям рынка для дашборда. */
async function buildSkillMatch(user: CurrentUser): Promise<SkillMatchSummaryDto> {
  const gaps = await skillsService.gaps(user, { limit: 200 })
  const total = gaps.data.length

  if (total === 0) {
    return {
      coveragePercent: null,
      coveredSkills: 0,
      demandedSkills: 0,
      criticalGaps: 0,
      period: gaps.period ?? '—',
      isMock: gaps.isMock,
    }
  }

  const covered = gaps.data.filter((row) => row.coverage > 0).length
  return {
    coveragePercent: percent(covered, total),
    coveredSkills: covered,
    demandedSkills: total,
    criticalGaps: gaps.data.filter((row) => row.isCritical).length,
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

  const [
    activeCooperations,
    universitiesInWork,
    completedStages,
    cycles,
    programs,
    problemStages,
    logged,
    skillMatch,
    priorityRows,
  ] = await Promise.all([
    repo.countActiveCooperations(scope),
    repo.countUniversitiesInWork(scope),
    repo.findCompletedStagesWithDeadline(scope),
    repo.findCycleDurations(scope),
    repo.findProgramsForRating(scope, 200),
    repo.findProblemStages(scope, now, DASHBOARD_TOP_LIMIT),
    repo.countLoggedOperations(scope),
    buildSkillMatch(user),
    repo.findPriorityRecommendations(scope, DASHBOARD_TOP_LIMIT),
  ])

  const metrics: DashboardMetricDto[] = [
    metric(
      'activeCooperations',
      'Активные связи',
      activeCooperations,
      'связей',
      'Связки в статусах «Черновик» и «В работе»',
    ),
    metric(
      'universitiesInWork',
      'Вузы в работе',
      universitiesInWork,
      'вузов',
      'Вузы в статусах «В работе» и «Активен», кроме архивных',
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
    const onTime = completedStages.filter(
      (stage) => stage.completedAt && stage.deadline && stage.completedAt <= stage.deadline,
    ).length
    metrics.push(
      metric(
        'stagesOnTimePercent',
        'Этапы, закрытые в срок',
        percent(onTime, completedStages.length) ?? 0,
        '%',
        `${onTime} из ${completedStages.length} завершённых этапов закрыты не позже срока`,
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
    metrics.push(
      metric(
        'avgDaysToClasses',
        'Среднее время до начала занятий',
        round(average, 1),
        'дней',
        `Среднее по ${cycles.length} связкам, где заполнены первый контакт и начало занятий`,
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
        { basis: 'estimate' },
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
  )

  const topPrograms: TopProgramDto[] = programs
    .map((program) => {
      const rating = ratings.get(program.id)
      return {
        programId: program.id,
        programName: program.name,
        universityId: program.university.id,
        universityName: program.university.name,
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
      programName: stage.cooperation.program.name,
      reason:
        stage.status === 'BLOCKED'
          ? `Этап заблокирован: ${stage.blockingReason ?? 'причина не указана'}`
          : `Этап просрочен на ${overdueDays ?? 0} дн.`,
      stageNumber: stage.stageNumber,
      stageTitle: stage.title,
      daysOverdue: overdueDays,
    }
  })

  const priorityActions: RecommendationDto[] = priorityRows.map(toRecommendationDto)

  return {
    metrics,
    topPrograms,
    problemCooperations,
    priorityActions,
    skillMatch,
    generatedAt: now.toISOString(),
    containsMockData: skillMatch.isMock || programs.some((program) => program.isMock),
  }
}


export interface RankedProgramDto extends ProgramRatingDto {
  programName: string
  universityId: string
  universityName: string
  isMock: boolean
}

/**
 * Рейтинг программ с раскрытием вклада каждого показателя (концепция, решение 7).
 * Баллы нормируются внутри выборки, поэтому сравнивать их можно только внутри одного ответа.
 */
export async function programRating(
  user: CurrentUser,
  options: { limit: number },
): Promise<{ data: RankedProgramDto[]; total: number }> {
  assertCan(user, 'ANALYTICS')

  const programs = await repo.findProgramsForRating(universityScope(user), 500)
  const ratings = calculateRatings(
    programs.map((program) => ({
      programId: program.id,
      applicationCount: program.applicationCount,
      studentCount: program.studentCount,
      groupCount: program.groupCount,
      metricsSource: program.metricsSource,
    })),
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

  return { data: ranked.slice(0, options.limit), total: ranked.length }
}
