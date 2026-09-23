'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import type {
  DashboardOverviewDto,
  ProblemCooperationDto,
  RecommendationGenerationResultDto,
  TopProgramDto,
} from '@/shared/contracts'
import {
  Badge,
  Button,
  Card,
  CardsSkeleton,
  CellText,
  DataTable,
  EmptyState,
  ErrorState,
  KpiStrip,
  MockBadge,
  PageHeader,
  PriorityBadge,
  Progress,
  Section,
  Tooltip,
  apiPost,
  cooperationHref,
  deadlineBadgeText,
  formatDateTime,
  formatNumber,
  formatPercent,
  formatScore,
  pluralize,
  programHref,
  recommendationHref,
  useCurrentUser,
  useMutation,
  useResource,
  useToast,
  type Column,
} from '@/ui'
import styles from './dashboard.module.css'

/**
 * Подпись над списком проблем.
 *
 * Считаются этапы, а не связки: у одной связки их бывает несколько, и это
 * разные проблемы с разными сроками. Если показаны не все, так и сказано —
 * выдать десять строк за всё, когда их тринадцать, значит соврать на первом
 * же экране.
 */
function problemSummary(total: number, shown: number): string {
  if (total === 0) return 'Просроченных и заблокированных этапов нет.'
  const stages = `${formatNumber(total)} ${pluralize(total, ['этап стоит', 'этапа стоят', 'этапов стоят'])}`
  if (shown < total) return `${stages}: срок вышел или этап заблокирован. Показаны ${shown} самых давних.`
  return `${stages}: срок вышел или этап заблокирован.`
}

/**
 * Главная страница.
 *
 * Отвечает на четыре вопроса раздела 25 шаблона: что происходит, где проблема,
 * что делать и почему система это предлагает. Один запрос к `/api/analytics/overview`:
 * сводку собирает сервер, фронт её не пересчитывает.
 *
 * Порядок по решению Артура: показатели — одной строкой, проблемные связки —
 * главным блоком первого экрана. Пять плиток одинакового веса занимали полэкрана
 * и прятали то, ради чего главную открывают: где горит.
 */
export default function DashboardPage() {
  const user = useCurrentUser()
  const router = useRouter()
  const toast = useToast()

  // Представителю вуза аналитика закрыта — у него свой кабинет.
  useEffect(() => {
    if (user.role === 'UNIVERSITY_REP') router.replace('/portal')
  }, [user.role, router])

  const overview = useResource<DashboardOverviewDto>(
    user.role === 'UNIVERSITY_REP' ? null : '/api/analytics/overview',
  )

  const regenerate = useMutation(async () => {
    const result = await apiPost<RecommendationGenerationResultDto>('/api/recommendations/generate')
    return result.data
  })

  async function onRegenerate() {
    const result = await regenerate.run(undefined)
    if (!result.ok) {
      toast.error(result.error.message)
      return
    }
    const { created, updated, closed } = result.data
    toast.success(
      `Рекомендации пересобраны: новых ${created}, обновлено ${updated}, закрыто ${closed}.`,
    )
    overview.reload()
  }

  const data = overview.data

  const problemColumns: Column<ProblemCooperationDto>[] = [
    {
      key: 'cooperation',
      title: 'Связка',
      render: (row) => (
        <CellText strong title={`${row.universityName} — ${row.programName}`}>
          {row.universityShortName ?? row.universityName} — {row.programName}
        </CellText>
      ),
    },
    {
      key: 'stage',
      title: 'Где встала',
      render: (row) =>
        row.stageNumber === null ? (
          <CellText muted>—</CellText>
        ) : (
          <CellText title={`Этап ${row.stageNumber}: ${row.stageTitle ?? ''}`}>
            {row.stageNumber}. {row.stageTitle}
          </CellText>
        ),
    },
    {
      // Отдельного столбца с причиной нет: для просрочки она повторяла бы
      // число дней. Причина блокировки — в подсказке у значка «блок».
      key: 'days',
      title: 'Просрочка',
      width: '104px',
      align: 'right',
      render: (row) =>
        row.daysOverdue === null ? (
          <Badge tone="warning" withDot title={row.reason}>
            блок
          </Badge>
        ) : (
          <Badge tone="danger" withDot title={row.reason}>
            {deadlineBadgeText('overdue', row.daysOverdue, true)}
          </Badge>
        ),
    },
  ]

  const programColumns: Column<TopProgramDto>[] = [
    {
      key: 'program',
      title: 'Программа',
      render: (row) => (
        <CellText strong title={`${row.programName} — ${row.universityName}`}>
          {row.programName}
          <span className={styles.muted}> · {row.universityName}</span>
        </CellText>
      ),
    },
    {
      key: 'factors',
      title: 'Из чего сложился балл',
      render: (row) => {
        const text =
          row.factors
            .filter((factor) => factor.value !== null)
            .map((factor) => `${factor.title}: ${formatNumber(factor.value)}`)
            .join(' · ') || 'Показатели не заполнены'
        return <CellText muted>{text}</CellText>
      },
    },
    {
      key: 'score',
      title: 'Балл',
      align: 'right',
      width: '80px',
      render: (row) =>
        row.score === null ? (
          <span className={styles.scoreEmpty}>Нет данных</span>
        ) : (
          <span className={styles.score}>{formatScore(row.score)}</span>
        ),
    },
  ]

  return (
    <>
      <PageHeader
        title="Главная"
        description="Что требует внимания прямо сейчас и что система предлагает сделать."
        meta={data?.containsMockData ? <MockBadge /> : undefined}
        actions={
          user.permissions.canWrite ? (
            <Button
              icon="refresh"
              onClick={onRegenerate}
              isLoading={regenerate.isPending}
              variant="secondary"
            >
              Пересобрать рекомендации
            </Button>
          ) : undefined
        }
      />

      {overview.isLoading ? (
        <CardsSkeleton count={3} />
      ) : overview.error ? (
        <ErrorState error={overview.error} onRetry={overview.reload} />
      ) : data ? (
        <>
          <KpiStrip
            items={data.metrics.map((metric) => ({
              key: metric.key,
              label: metric.title,
              value: metric.value,
              unit: metric.unit === 'шт' || metric.unit === '%' ? undefined : metric.unit,
              explanation: metric.explanation,
              fractionDigits: metric.unit === '%' ? 1 : 0,
              note:
                metric.unit === '%'
                  ? metric.basis === 'estimate'
                    ? 'процентов, оценка'
                    : 'процентов'
                  : metric.basis === 'estimate'
                    ? 'оценка'
                    : undefined,
              isMock: metric.isMock,
            }))}
          />

          <div className={styles.focus}>
            <Section
              title="Требует внимания"
              description={problemSummary(
                data.problemStageTotal,
                data.problemCooperations.length,
              )}
              action={
                <Button href="/cooperations" variant="ghost" size="sm" icon="arrowRight" iconPosition="right">
                  Все связки
                </Button>
              }
            >
              <Card padding="none" className={styles.alert}>
                {data.problemCooperations.length === 0 ? (
                  <EmptyState
                    icon="check"
                    title="Проблемных связок нет"
                    description="Ни одна связка не просрочена и не заблокирована."
                  />
                ) : (
                  <DataTable
                    rows={data.problemCooperations}
                    columns={problemColumns}
                    // У одной связки бывает несколько проблем: ключ — связка и этап.
                    getRowKey={(row) => `${row.cooperationId}:${row.stageId ?? row.reason}`}
                    getRowHref={(row) => cooperationHref(row.cooperationId, row.stageId)}
                    caption="Связки, которые требуют внимания"
                  />
                )}
              </Card>
            </Section>

            <Section
              title="Приоритетные действия"
              description="Открытые рекомендации с наибольшим приоритетом."
              action={
                <Button href="/recommendations" variant="ghost" size="sm" icon="arrowRight" iconPosition="right">
                  Все
                </Button>
              }
            >
              <Card padding="none">
                {data.priorityActions.length === 0 ? (
                  <EmptyState
                    icon="recommendation"
                    title="Рекомендаций нет"
                    description="Система ещё не собирала предложения или все они закрыты."
                    action={
                      user.permissions.canWrite ? (
                        <Button icon="refresh" onClick={onRegenerate} isLoading={regenerate.isPending}>
                          Собрать сейчас
                        </Button>
                      ) : undefined
                    }
                  />
                ) : (
                  <ul className={styles.actions}>
                    {data.priorityActions.map((action) => (
                      <li key={action.id}>
                        <a className={styles.action} href={recommendationHref(action.id)}>
                          <span className={styles.actionHead}>
                            <span className={styles.actionTitle}>{action.title}</span>
                            <PriorityBadge priority={action.priority} />
                          </span>
                          <span className={styles.actionWhy} title={action.justification}>
                            {action.justification}
                          </span>
                          <span className={styles.actionTarget}>{action.target.label}</span>
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </Section>
          </div>

          <div className={styles.columns}>
            <Section
              title="Ключевые программы"
              description="Верх рейтинга. Балл относительный: программы сравниваются между собой."
              action={
                <Button href="/analytics" variant="ghost" size="sm" icon="arrowRight" iconPosition="right">
                  Вся аналитика
                </Button>
              }
            >
              <Card padding="none">
                {data.topPrograms.length === 0 ? (
                  <EmptyState
                    icon="program"
                    title="Рейтинг пуст"
                    description="Ни у одной программы не заполнены показатели набора."
                  />
                ) : (
                  <DataTable
                    rows={data.topPrograms}
                    columns={programColumns}
                    getRowKey={(row) => row.programId}
                    getRowHref={(row) => programHref(row.programId)}
                    caption="Программы с наибольшим баллом"
                  />
                )}
              </Card>
            </Section>

            <Section
              title="Покрытие навыков"
              description="Насколько программы закрывают то, что востребовано рынком."
            >
              <Card>
                <div className={styles.coverage}>
                  <div className={styles.coverageTop}>
                    <span className={styles.coverageValue}>
                      {formatPercent(data.skillMatch.coveragePercent)}
                    </span>
                    <span className={styles.coverageNote}>
                      период {data.skillMatch.period}
                      {data.skillMatch.isMock && ' · демонстрационные данные'}
                    </span>
                  </div>

                  <Progress
                    value={data.skillMatch.coveragePercent}
                    label="Покрытие востребованных навыков"
                    tone={
                      data.skillMatch.coveragePercent !== null && data.skillMatch.coveragePercent < 50
                        ? 'danger'
                        : 'default'
                    }
                  />

                  <div className={styles.coverageFacts}>
                    <span className={styles.fact}>
                      <span className={styles.factValue}>{formatNumber(data.skillMatch.coveredSkills)}</span>
                      <span className={styles.factLabel}>навыков покрыто</span>
                    </span>
                    <span className={styles.fact}>
                      <span className={styles.factValue}>{formatNumber(data.skillMatch.demandedSkills)}</span>
                      <span className={styles.factLabel}>востребовано рынком</span>
                    </span>
                    <span className={styles.fact}>
                      <span className={styles.factValue}>{formatNumber(data.skillMatch.criticalGaps)}</span>
                      <span className={styles.factLabel}>критических дефицитов</span>
                    </span>
                  </div>

                  <Button href="/analytics?tab=skills" variant="secondary" size="sm" icon="skill">
                    Разобрать дефициты
                  </Button>
                </div>
              </Card>
            </Section>
          </div>

          <p className={styles.generated}>
            <Tooltip text="Сводка считается при каждом запросе: данные всегда свежие.">
              <span>Обновлено: {formatDateTime(data.generatedAt)}</span>
            </Tooltip>
          </p>
        </>
      ) : null}
    </>
  )
}
