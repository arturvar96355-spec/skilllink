'use client'

import { useEffect, useMemo, useState } from 'react'
import { USER_ROLE_LABELS } from '@/shared/contracts'
import type { DashboardOverviewDto, StageWithCooperationDto } from '@/shared/contracts'
import {
  ApiRequestError,
  Button,
  CardsSkeleton,
  ErrorState,
  MockBadge,
  NO_DATA,
  PageHeader,
  PriorityBadge,
  ROUTES,
  apiGet,
  buildQuery,
  formatDateTime,
  formatNumber,
  formatPercent,
  formatScore,
  useCurrentUser,
  useResource,
} from '@/ui'
import {
  REPORT_METRIC_KEYS,
  activeBreakdown,
  funnelComposition,
  mergeProblemStages,
  metricValueText,
  problemDetail,
  problemReason,
  problemSummary,
  reportDocumentTitle,
  criticalGapsLabel,
  skillCoverageCount,
  sourceLine,
  trendText,
  universityShortNames,
  type ReportProblem,
} from './report'
import styles from './report.module.css'

/** Больше сотни за раз API не отдаёт (`MAX_PAGE_SIZE`). */
const PAGE_SIZE = 100
/** Не больше двадцати страниц на список — 2000 этапов: отчёт — лист, а не выгрузка. */
const MAX_PAGES = 20

interface StageList {
  rows: StageWithCooperationDto[]
  total: number
}

/** Список дел целиком, страница за страницей: главная показывает только десять самых давних. */
async function loadAllStages(path: string, signal: AbortSignal): Promise<StageList> {
  const rows: StageWithCooperationDto[] = []
  let total = 0
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const result = await apiGet<StageWithCooperationDto[]>(`${path}${buildQuery({ page, pageSize: PAGE_SIZE })}`, signal)
    rows.push(...result.data)
    total = result.meta?.total ?? rows.length
    if (result.data.length < PAGE_SIZE || rows.length >= total) break
  }
  return { rows, total }
}

interface ProblemStages {
  problems: ReportProblem[]
  /** Списки длиннее `MAX_PAGES` страниц показаны не целиком — так и сказать. */
  isTruncated: boolean
}

/**
 * Все проблемные этапы — просроченные и заблокированные — из списков дел.
 * Ошибку и загрузку отдаёт в том же виде, что `useResource`.
 */
function useProblemStages(enabled: boolean) {
  const [loaded, setLoaded] = useState<ProblemStages | null>(null)
  const [error, setError] = useState<ApiRequestError | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    Promise.all([
      loadAllStages('/api/workflow/overdue', controller.signal),
      loadAllStages('/api/workflow/blocked', controller.signal),
    ])
      .then(([overdue, blocked]) => {
        setLoaded({
          problems: mergeProblemStages(overdue.rows, blocked.rows),
          isTruncated: overdue.rows.length < overdue.total || blocked.rows.length < blocked.total,
        })
        setError(null)
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return
        setError(caught instanceof ApiRequestError ? caught : new ApiRequestError('Непредвиденная ошибка', 'INTERNAL', 0))
      })
    return () => controller.abort()
  }, [enabled, attempt])

  return {
    data: loaded,
    error,
    isLoading: enabled && loaded === null && error === null,
    reload: () => {
      setLoaded(null)
      setError(null)
      setAttempt((value) => value + 1)
    },
  }
}

/**
 * Отчёт руководителю (решение 97): состояние сотрудничества с вузами на листе A4.
 *
 * Руководитель открывает его и за минуту видит, где горит; кнопка «Печать / PDF»
 * отдаёт тот же лист в окно печати, откуда его сохраняют в PDF и отправляют.
 * Данные — только из существующих API: сводка главной и списки дел по этапам.
 * На экране лист выглядит так же, как на бумаге, в обоих режимах интерфейса:
 * это документ, а не витрина.
 */
export default function ManagerReportPage() {
  const user = useCurrentUser()
  // Представителю вуза сводка ответит отказом — он и будет показан, как на других
  // закрытых для него страницах. Списки дел ему не запрашиваются вовсе.
  const overview = useResource<DashboardOverviewDto>('/api/analytics/overview')
  const stages = useProblemStages(user.permissions.canSeeAnalytics)

  const data = overview.data
  const generatedAt = data?.generatedAt ?? null

  // Заголовок вкладки — имя файла в «Сохранить как PDF».
  useEffect(() => {
    if (!generatedAt) return
    const previous = document.title
    document.title = reportDocumentTitle(generatedAt)
    return () => {
      document.title = previous
    }
  }, [generatedAt])

  const isReady = Boolean(data && stages.data)

  return (
    <>
      <PageHeader
        title="Отчёт руководителю"
        breadcrumbs={[{ label: 'Главная', href: ROUTES.dashboard }, { label: 'Отчёт руководителю' }]}
        description="Состояние сотрудничества с вузами — документ A4 для печати и отправки. «Печать / PDF» открывает окно печати: чтобы получить файл, выберите в нём «Сохранить как PDF»."
        actions={
          isReady ? (
            <Button variant="primary" icon="download" onClick={() => window.print()}>
              Печать / PDF
            </Button>
          ) : undefined
        }
      />

      {overview.isLoading || stages.isLoading ? (
        <CardsSkeleton count={3} />
      ) : overview.error ? (
        <ErrorState error={overview.error} onRetry={overview.reload} />
      ) : stages.error ? (
        <ErrorState error={stages.error} onRetry={stages.reload} />
      ) : data && stages.data ? (
        <ReportSheet
          data={data}
          problems={stages.data.problems}
          isTruncated={stages.data.isTruncated}
          author={`${user.fullName}, ${user.position ?? USER_ROLE_LABELS[user.role]}`}
        />
      ) : null}
    </>
  )
}

/** Рост зелёным, падение красным, без изменений — нейтрально, как на главной. */
const TREND_CLASS = {
  up: styles.trendUp,
  down: styles.trendDown,
  flat: styles.trendFlat,
} as const

/** Сам лист: всё, что уходит на печать. Остальная страница при печати скрыта (globals.css). */
function ReportSheet({
  data,
  problems,
  isTruncated,
  author,
}: {
  data: DashboardOverviewDto
  problems: ReportProblem[]
  isTruncated: boolean
  author: string
}) {
  const shortNames = useMemo(() => universityShortNames(data), [data])
  const metrics = REPORT_METRIC_KEYS.flatMap((key) => data.metrics.filter((metric) => metric.key === key))
  const skills = data.skillMatch
  const generated = `${formatDateTime(data.generatedAt)} (МСК)`

  return (
    <article className={styles.sheet} data-print-document aria-label="Отчёт руководителю">
      {/* div, а не header/footer: правила каркаса для шапки (сборка после входа) листа касаться не должны. */}
      <div className={styles.head}>
        <div className={styles.kickerRow}>
          <p className={styles.kicker}>
            <span className={styles.brand}>SkillLink</span> · Отчёт руководителю ИТ-Школы
          </p>
          {data.containsMockData && <MockBadge />}
        </div>
        <h2 className={styles.title}>Состояние сотрудничества с вузами</h2>
        <p className={styles.meta}>
          <span>Сформирован {generated}</span>
          <span>Сформировал: {author}</span>
        </p>
      </div>

      <section className={styles.block} aria-labelledby="report-kpi">
        <h3 id="report-kpi" className={styles.blockTitle}>
          Ключевые показатели
        </h3>
        <p className={styles.lead}>
          {activeBreakdown(data.cooperationCounts)}. {funnelComposition(data.cooperationCounts)}.
        </p>
        <dl className={styles.kpis}>
          {metrics.map((metric) => (
            <div key={metric.key} className={styles.kpi}>
              <dt className={styles.kpiLabel}>{metric.title}</dt>
              <dd className={metric.value === null ? styles.kpiEmpty : styles.kpiValue}>{metricValueText(metric)}</dd>
              {(metric.trend || metric.basis === 'estimate') && (
                <dd className={styles.kpiNote}>
                  {metric.trend && (
                    <span className={TREND_CLASS[metric.trend.direction]}>
                      {trendText(metric.trend, metric.unit === '%')}
                    </span>
                  )}
                  {metric.basis === 'estimate' && <span className={styles.estimate}>оценка</span>}
                </dd>
              )}
            </div>
          ))}
        </dl>
      </section>

      <section className={styles.block} aria-labelledby="report-attention">
        <div className={styles.blockHead}>
          <h3 id="report-attention" className={styles.blockTitle}>
            Требует внимания
          </h3>
          <p className={styles.note}>
            {problemSummary(problems)}
            {isTruncated &&
              ` Показаны первые ${formatNumber(problems.length)} из ${formatNumber(data.problemStageTotal)}, остальные — в реестре связок.`}
          </p>
        </div>
        {problems.length > 0 && (
          <table className={styles.table}>
            <colgroup>
              <col className={styles.colUniversity} />
              <col className={styles.colProgram} />
              <col className={styles.colStage} />
              <col className={styles.colReason} />
            </colgroup>
            <thead>
              <tr>
                <th scope="col">Вуз</th>
                <th scope="col">Программа</th>
                <th scope="col">Этап</th>
                <th scope="col">Причина</th>
              </tr>
            </thead>
            <tbody>
              {problems.map((problem) => {
                const detail = problemDetail(problem)
                return (
                  <tr key={problem.key}>
                    <td>{shortNames.get(problem.university) ?? problem.university}</td>
                    <td>{problem.program}</td>
                    <td>
                      <span className={styles.stageNo}>{problem.stageNumber}.</span> {problem.stageTitle}
                    </td>
                    <td>
                      <span className={problem.isBlocked ? styles.blocked : styles.overdue}>{problemReason(problem)}</span>
                      {detail && <span className={styles.detail}>{detail}</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </section>

      <section className={styles.block} aria-labelledby="report-actions">
        <div className={styles.blockHead}>
          <h3 id="report-actions" className={styles.blockTitle}>
            Приоритетные действия
          </h3>
          <p className={styles.note}>открытые рекомендации, самые важные сверху</p>
        </div>
        {data.priorityActions.length === 0 ? (
          <p className={styles.note}>Открытых рекомендаций нет.</p>
        ) : (
          <ol className={styles.list}>
            {data.priorityActions.map((action) => (
              <li key={action.id} className={styles.action}>
                <span>
                  <PriorityBadge priority={action.priority} />
                </span>
                <span className={styles.actionText}>
                  <span className={styles.itemTitle}>{action.title}</span>
                  <span className={styles.actionTarget}> · {action.target.label}</span>
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* Две колонки: где набирать людей — слева, чем дополнить обучение — справа. */}
      <div className={styles.columns}>
        <section className={styles.block} aria-labelledby="report-programs">
          <div className={styles.blockHead}>
            <h3 id="report-programs" className={styles.blockTitle}>
              Лучшие программы
            </h3>
            <p className={styles.note}>балл из 100</p>
          </div>
          {data.topPrograms.length === 0 ? (
            <p className={styles.note}>Ни у одной программы не заполнены показатели набора.</p>
          ) : (
            <ol className={styles.list}>
              {data.topPrograms.map((program, index) => (
                <li key={program.programId} className={styles.rank}>
                  <span className={styles.rankNo}>{index + 1}</span>
                  <span className={styles.itemBody}>
                    <span className={styles.itemTitle}>{program.programName}</span>
                    <span className={styles.detail}>
                      {program.universityShortName ?? program.universityName}
                      {program.basis === 'estimate' && ' · оценка'}
                    </span>
                  </span>
                  <span className={styles.score}>{program.score === null ? NO_DATA : formatScore(program.score)}</span>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className={styles.block} aria-labelledby="report-skills">
          <div className={styles.blockHead}>
            <h3 id="report-skills" className={styles.blockTitle}>
              Навыки
            </h3>
            <p className={styles.note}>спрос рынка за {skills.period}</p>
          </div>
          <dl className={styles.facts}>
            <div className={styles.fact}>
              <dt className={styles.factValue}>{formatPercent(skills.coveragePercent)}</dt>
              <dd className={styles.factLabel}>покрытие навыков, востребованных рынком</dd>
            </div>
            <div className={styles.fact}>
              <dt className={styles.factValue}>{skillCoverageCount(skills)}</dt>
              <dd className={styles.factLabel}>востребованных навыков есть в программах</dd>
            </div>
            <div className={styles.fact}>
              <dt className={styles.factValue}>{formatNumber(skills.criticalGaps)}</dt>
              <dd className={styles.factLabel}>{criticalGapsLabel(skills.criticalGaps)}</dd>
            </div>
          </dl>
        </section>
      </div>

      <div className={styles.foot}>
        <p>Сформировано в SkillLink {generated}</p>
        <p>{sourceLine(data)}</p>
      </div>
    </article>
  )
}
