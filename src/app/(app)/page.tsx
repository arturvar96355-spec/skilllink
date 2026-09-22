'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import type { DashboardOverviewDto } from '@/shared/contracts'
import {
  Badge,
  Button,
  Card,
  CardsSkeleton,
  DataTable,
  EmptyState,
  ErrorState,
  Icon,
  KpiCard,
  MockBadge,
  PageHeader,
  PriorityBadge,
  Progress,
  Section,
  Tooltip,
  apiPost,
  cooperationHref,
  formatDateTime,
  formatNumber,
  formatPercent,
  formatScore,
  programHref,
  recommendationHref,
  useCurrentUser,
  useMutation,
  useResource,
  useToast,
  type Column,
} from '@/ui'
import type { RecommendationGenerationResultDto, TopProgramDto } from '@/shared/contracts'
import styles from './dashboard.module.css'

/** Значок показателя подбирается по его ключу — названия приходят с сервера. */
const METRIC_ICONS: Record<string, 'cooperation' | 'university' | 'check' | 'clock' | 'analytics'> = {
  activeCooperations: 'cooperation',
  universitiesInWork: 'university',
  stagesOnTimePercent: 'check',
  avgDaysToClasses: 'clock',
  operationsPerCooperation: 'analytics',
}

/**
 * Главная страница.
 *
 * Отвечает на четыре вопроса раздела 25 шаблона: что происходит, где проблема,
 * что делать и почему система это предлагает. Один запрос к `/api/analytics/overview`:
 * сводку собирает сервер, фронт её не пересчитывает.
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

  const programColumns: Column<TopProgramDto>[] = [
    {
      key: 'program',
      title: 'Программа',
      render: (row) => (
        <span className={styles.programRow}>
          <span className={styles.programText}>
            <span className={styles.programName}>{row.programName}</span>
            <span className={styles.programUniversity}>{row.universityName}</span>
          </span>
        </span>
      ),
    },
    {
      key: 'factors',
      title: 'Из чего сложился балл',
      render: (row) => (
        <span className={styles.itemMeta}>
          {row.factors
            .filter((factor) => factor.value !== null)
            .map((factor) => `${factor.title}: ${formatNumber(factor.value)}`)
            .join(' · ') || 'Показатели не заполнены'}
        </span>
      ),
    },
    {
      key: 'score',
      title: 'Балл',
      align: 'right',
      width: '120px',
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
        description="Что требует внимания прямо сейчас: показатели работы, проблемные связки и предложения системы."
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
        <CardsSkeleton count={4} />
      ) : overview.error ? (
        <ErrorState error={overview.error} onRetry={overview.reload} />
      ) : data ? (
        <>
          <div className={styles.kpis}>
            {data.metrics.map((metric) => (
              <KpiCard
                key={metric.key}
                label={metric.title}
                value={metric.value}
                unit={metric.unit === 'шт' ? undefined : metric.unit}
                icon={METRIC_ICONS[metric.key] ?? 'analytics'}
                explanation={metric.explanation}
                fractionDigits={metric.unit === '%' ? 1 : 0}
                note={metric.basis === 'estimate' ? 'Оценка' : (metric.period ?? undefined)}
                footer={metric.isMock ? <Badge tone="mock">демо</Badge> : undefined}
              />
            ))}
          </div>

          <div className={styles.columns}>
            <Section
              title="Требует внимания"
              description="Связки, где процесс встал: просроченные, заблокированные и без движения."
              action={
                data.problemCooperations.length > 0 ? (
                  <Button href="/cooperations" variant="ghost" size="sm" icon="arrowRight" iconPosition="right">
                    Все связки
                  </Button>
                ) : undefined
              }
            >
              {data.problemCooperations.length === 0 ? (
                <Card muted>
                  <EmptyState
                    icon="check"
                    title="Проблемных связок нет"
                    description="Ни одна связка не просрочена и не заблокирована."
                  />
                </Card>
              ) : (
                <div className={styles.list}>
                  {data.problemCooperations.map((problem) => (
                    // У одной связки бывает несколько проблем: ключ собирается из связки и этапа.
                    <Card
                      key={`${problem.cooperationId}:${problem.stageNumber ?? 'нет'}:${problem.reason}`}
                      href={cooperationHref(problem.cooperationId)}
                      padding="sm"
                    >
                      <span className={styles.problem}>
                        <span className={styles.problemIcon}>
                          <Icon name="alert" size={18} />
                        </span>
                        <span className={styles.problemText}>
                          <span className={styles.itemTitle}>
                            {problem.universityName} — {problem.programName}
                          </span>
                          <span className={styles.itemReason}>{problem.reason}</span>
                          {problem.stageNumber !== null && (
                            <span className={styles.itemMeta}>
                              Этап {problem.stageNumber}: {problem.stageTitle}
                            </span>
                          )}
                        </span>
                        {problem.daysOverdue !== null && (
                          <Badge tone="danger">{Math.abs(problem.daysOverdue)} дн.</Badge>
                        )}
                      </span>
                    </Card>
                  ))}
                </div>
              )}
            </Section>

            <Section
              title="Приоритетные действия"
              description="Открытые рекомендации системы с наибольшим приоритетом."
              action={
                data.priorityActions.length > 0 ? (
                  <Button href="/recommendations" variant="ghost" size="sm" icon="arrowRight" iconPosition="right">
                    Все рекомендации
                  </Button>
                ) : undefined
              }
            >
              {data.priorityActions.length === 0 ? (
                <Card muted>
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
                </Card>
              ) : (
                <div className={styles.list}>
                  {data.priorityActions.map((action) => (
                    <Card key={action.id} href={recommendationHref(action.id)} padding="sm">
                      <span className={styles.action}>
                        <span className={styles.actionHead}>
                          <span className={styles.itemTitle}>{action.title}</span>
                          <PriorityBadge priority={action.priority} />
                        </span>
                        <span className={styles.justification}>{action.justification}</span>
                        <span className={styles.actionTarget}>
                          <Icon name="arrowRight" size={16} />
                          {action.target.label}
                        </span>
                      </span>
                    </Card>
                  ))}
                </div>
              )}
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
