'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import type { CSSProperties } from 'react'
import Link from 'next/link'
import type {
  CooperationListItemDto,
  DashboardOverviewDto,
  RecommendationGenerationResultDto,
} from '@/shared/contracts'
import { LiveRail, type RailNumber } from './LiveRail'
import {
  Badge,
  Button,
  CardsSkeleton,
  EmptyState,
  ErrorState,
  MockBadge,
  PageHeader,
  PriorityBadge,
  Progress,
  Section,
  apiPost,
  buildQuery,
  cooperationHref,
  deadlineBadgeText,
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
  startMorph,
} from '@/ui'
import styles from './dashboard.module.css'

/** Знаков после запятой у показателей главной. Остальные — целые. */
const FRACTION_DIGITS: Record<string, number> = {
  stagesOnTimePercent: 1,
  operationsPerCooperation: 1,
}

/**
 * Единицы показателей — по числу: сервер присылает одну форму («вузов», «дней»),
 * и главная писала «4 вузов», «204 дней».
 */
const UNIT_FORMS: Record<string, [string, string, string]> = {
  activeCooperations: ['связь', 'связи', 'связей'],
  universitiesInWork: ['вуз', 'вуза', 'вузов'],
  stagesOnTimePercent: ['процент', 'процента', 'процентов'],
  avgDaysToClasses: ['день', 'дня', 'дней'],
  operationsPerCooperation: ['операция', 'операции', 'операций'],
}

/** Единица показателя в нужной форме — по значению, как оно показано. */
function unitFor(key: string, value: number | null, fallback: string): string {
  const forms = UNIT_FORMS[key]
  if (!forms || value === null) return fallback
  const digits = FRACTION_DIGITS[key] ?? 0
  return pluralize(Number(value.toFixed(digits)), forms)
}

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

/** Номер этапа в записи маршрута: «06 / 14» (07, раздел 30). */
function stageNotation(stage: number): string {
  return `${String(stage).padStart(2, '0')} / 14`
}

/** Приветствие по московскому времени — там же, где показаны все даты. */
function greeting(now = new Date()): string {
  const hour = Number(
    new Intl.DateTimeFormat('ru-RU', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Europe/Moscow' }).format(now),
  )
  if (hour < 5) return 'Доброй ночи'
  if (hour < 12) return 'Доброе утро'
  if (hour < 18) return 'Добрый день'
  return 'Добрый вечер'
}

/** Связки в работе — для маршрута и строк «вуз — программа — продукт». */
const ACTIVE_COOPERATIONS_PATH = `/api/cooperations${buildQuery({
  status: ['DRAFT', 'ACTIVE'],
  sort: '-updatedAt',
  pageSize: 100,
})}`

/** Короткие подписи показателей рейтинга — для строки «из чего сложился балл». */
/** Движение числа в Live Rail — по смыслу показателя (07, раздел 20). */
const RAIL_MOTION: Record<string, RailNumber['motion']> = {
  activeCooperations: 'count',
  universitiesInWork: 'still',
  stagesOnTimePercent: 'segments',
  avgDaysToClasses: 'timeline',
  operationsPerCooperation: 'still',
}

const FACTOR_SHORT: Record<string, string> = {
  applicationCount: 'заявки',
  studentCount: 'обучающиеся',
  groupCount: 'группы',
}

/** Сколько связок показывать строками маршрута под главным блоком. */
const ROUTE_ROWS = 6

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
  const active = useResource<CooperationListItemDto[]>(
    user.role === 'UNIVERSITY_REP' ? null : ACTIVE_COOPERATIONS_PATH,
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
    active.reload()
  }

  const data = overview.data
  const cooperations = active.data ?? []
  const firstName = user.fullName.split(' ')[1] ?? user.fullName

  const numbers: RailNumber[] = (data?.metrics ?? []).map((metric) => ({
    key: metric.key,
    label: metric.title,
    value: metric.value,
    unit:
      metric.unit === 'шт'
        ? undefined
        : metric.unit === '%'
          ? '%'
          : unitFor(metric.key, metric.value, metric.unit),
    digits: FRACTION_DIGITS[metric.key] ?? 0,
    note: metric.basis === 'estimate' ? 'оценка' : undefined,
    isMock: metric.isMock ?? false,
    explanation: metric.explanation,
    secondary: metric.key === 'operationsPerCooperation',
    motion: RAIL_MOTION[metric.key],
  }))

  const activeTotal = data?.metrics.find((metric) => metric.key === 'activeCooperations')?.value ?? null

  return (
    <>
      <PageHeader
        title={`${greeting()}, ${firstName}`}
        description={
          data
            ? `Сегодня ${formatNumber(activeTotal)} ${pluralize(activeTotal ?? 0, ['активная связь', 'активные связи', 'активных связей'])} · ${formatNumber(data.problemStageTotal)} ${pluralize(data.problemStageTotal, ['этап требует', 'этапа требуют', 'этапов требуют'])} внимания`
            : 'Что требует внимания прямо сейчас и что система предлагает сделать.'
        }
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
          <LiveRail
            numbers={numbers}
            cooperations={cooperations}
            problemTotal={data.problemStageTotal}
            generatedAt={data.generatedAt}
          />

          <div className={styles.focus}>
            <div id="attention" className={styles.reveal} style={{ '--delay': '410ms' } as CSSProperties}>
              <Section
                title="Требует внимания"
                description={problemSummary(data.problemStageTotal, data.problemCooperations.length)}
                action={
                  <Button href="/cooperations" variant="ghost" size="sm" icon="arrowRight" iconPosition="right">
                    Все связки
                  </Button>
                }
              >
                {data.problemCooperations.length === 0 ? (
                  <EmptyState
                    title="Проблемных связок нет"
                    description="Ни одна связка не просрочена и не заблокирована."
                  />
                ) : (
                  // Лента событий, а не таблица в рамке (07, раздел 10.E): точка
                  // на линии времени, связка, этап в записи маршрута, срок.
                  <ol className={styles.queue}>
                    {data.problemCooperations.map((row) => (
                      <li key={`${row.cooperationId}:${row.stageId ?? row.reason}`} className={styles.event}>
                        <span
                          className={[styles.eventMark, row.daysOverdue === null ? styles.blocked : ''].filter(Boolean).join(' ')}
                          aria-hidden
                        />
                        <Link
                          className={styles.eventLink}
                          href={cooperationHref(row.cooperationId, row.stageId)}
                          title={`${row.universityName} — ${row.programName}\n${row.reason}`}
                          onClick={(event) => startMorph(event.currentTarget, event)}
                        >
                          <span className={styles.eventTitle} data-morph-title>
                            {row.universityShortName ?? row.universityName} — {row.programName}
                          </span>
                          {row.stageNumber !== null && (
                            <span className={styles.eventMeta}>
                              <span className={styles.notation}>{stageNotation(row.stageNumber)}</span>
                              {row.stageTitle}
                            </span>
                          )}
                        </Link>
                        {row.daysOverdue === null ? (
                          <Badge tone="warning" withDot title={row.reason}>
                            блок
                          </Badge>
                        ) : (
                          <Badge tone="danger" withDot title={row.reason}>
                            {deadlineBadgeText('overdue', row.daysOverdue, true)}
                          </Badge>
                        )}
                      </li>
                    ))}
                  </ol>
                )}
              </Section>
            </div>

            <div className={styles.reveal} style={{ '--delay': '480ms' } as CSSProperties}>
              <Section
                title="Приоритетные действия"
                description="Открытые рекомендации с наибольшим приоритетом."
                action={
                  <Button href="/recommendations" variant="ghost" size="sm" icon="arrowRight" iconPosition="right">
                    Все
                  </Button>
                }
              >
                {data.priorityActions.length === 0 ? (
                  <EmptyState
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
              </Section>
            </div>
          </div>

          <div className={styles.columns}>
            <div className={styles.reveal} style={{ '--delay': '540ms' } as CSSProperties}>
              <Section
                title="Связки в работе"
                description="Вуз — программа — IT-продукт и этап, на котором связка сейчас."
                action={
                  <Button href="/cooperations" variant="ghost" size="sm" icon="arrowRight" iconPosition="right">
                    Все связки
                  </Button>
                }
              >
                {cooperations.length === 0 ? (
                  <EmptyState title="Связок в работе нет" description="Черновиков и связок в работе пока нет." />
                ) : (
                  <ul className={styles.routes}>
                    {cooperations.slice(0, ROUTE_ROWS).map((item) => (
                      <li key={item.id}>
                        <Link
                          className={styles.route}
                          href={cooperationHref(item.id)}
                          title={`${item.universityName} → ${item.programName} → ${item.productName ?? 'продукт не выбран'}`}
                          onClick={(event) => startMorph(event.currentTarget, event)}
                        >
                          <span className={styles.routeUni}>{item.universityShortName ?? item.universityName}</span>
                          <span className={styles.routeLine} aria-hidden />
                          <span className={styles.routeNode} data-morph-title>
                            {item.programName}
                          </span>
                          <span className={styles.routeLine} aria-hidden />
                          <span className={[styles.routeNode, item.productName ? '' : styles.routeMissing].filter(Boolean).join(' ')}>
                            {item.productName ?? 'продукт не выбран'}
                          </span>
                          <span className={styles.notation}>
                            {item.currentStage ? stageNotation(item.currentStage.stageNumber) : '—'}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
            </div>

            <div className={styles.reveal} style={{ '--delay': '600ms' } as CSSProperties}>
              <Section
                title="Ключевые программы"
                description="Верх рейтинга. Балл относительный — программы сравниваются между собой."
                action={
                  <Button href="/analytics" variant="ghost" size="sm" icon="arrowRight" iconPosition="right">
                    Вся аналитика
                  </Button>
                }
              >
                {data.topPrograms.length === 0 ? (
                  <EmptyState title="Рейтинг пуст" description="Ни у одной программы не заполнены показатели набора." />
                ) : (
                  <ol className={styles.ranking}>
                    {data.topPrograms.map((row, index) => {
                      const reason =
                        row.factors
                          .filter((factor) => factor.value !== null)
                          .map((factor) => `${FACTOR_SHORT[factor.key] ?? factor.title} ${formatNumber(factor.value)}`)
                          .join(' · ') || 'показатели не заполнены'
                      return (
                        <li key={row.programId}>
                          <Link
                            className={styles.rank}
                            href={programHref(row.programId)}
                            onClick={(event) => startMorph(event.currentTarget, event)}
                          >
                            <span className={styles.rankNo}>{String(index + 1).padStart(2, '0')}</span>
                            <span className={styles.rankBody}>
                              <span className={styles.rankUni} title={row.universityName}>
                                {row.universityShortName ?? row.universityName}
                              </span>
                              <span className={styles.rankProgram} data-morph-title>
                                {row.programName}
                              </span>
                              <span className={styles.rankReason}>{reason}</span>
                            </span>
                            <span className={styles.rankLine} aria-hidden />
                            <span className={row.score === null ? styles.scoreEmpty : styles.score}>
                              {row.score === null ? 'Нет данных' : formatScore(row.score)}
                            </span>
                          </Link>
                        </li>
                      )
                    })}
                  </ol>
                )}

                <div className={styles.coverage}>
                  <div className={styles.coverageTop}>
                    <span className={styles.coverageValue}>{formatPercent(data.skillMatch.coveragePercent)}</span>
                    <span className={styles.coverageNote}>
                      покрытие навыков · период {data.skillMatch.period}
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
                    <Button href="/analytics?tab=skills" variant="ghost" size="sm" iconPosition="right" icon="arrowRight">
                      Разобрать дефициты
                    </Button>
                  </div>
                </div>
              </Section>
            </div>
          </div>
        </>
      ) : null}
    </>
  )
}
