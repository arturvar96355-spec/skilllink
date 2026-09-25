'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import Link from 'next/link'
import type {
  CooperationListItemDto,
  DashboardOverviewDto,
  NotificationFeedDto,
  RecommendationGenerationResultDto,
  SkillGapDto,
  UniversityListItemDto,
} from '@/shared/contracts'
import { LiveRail, type RailNumber } from './LiveRail'
import { phaseFunnel } from './phase-funnel'
import { cityCoordinates } from './city-coordinates'
import {
  Badge,
  Button,
  CardsSkeleton,
  DeadlineStrip,
  Funnel,
  GapBars,
  Ring,
  ScoreBar,
  ScoreLegend,
  StageBar,
  RussiaMap,
  Ticker,
  notificationHref,
  universityHref,
  type MapPoint,
  type TickerItem,
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
  useUiMode,
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
/**
 * Связки для воронки: все, кроме отменённых. Больше сотни API за раз не отдаёт —
 * тогда под воронкой честно написано, по скольким она посчитана.
 */
const FUNNEL_PATH = `/api/cooperations${buildQuery({
  status: ['DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETED'],
  pageSize: 100,
})}`

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
  // Рабочий режим (решение 80): без бегущей строки, колец и карты — «Требует
  // внимания» и «Приоритетные действия» сразу под полосой «Активно сейчас».
  const { isWork } = useUiMode()

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
  const funnelSource = useResource<CooperationListItemDto[]>(
    user.role === 'UNIVERSITY_REP' ? null : FUNNEL_PATH,
  )
  const funnelSteps = useMemo(() => phaseFunnel(funnelSource.data ?? []), [funnelSource.data])
  const funnelTotal = funnelSource.meta?.total ?? null
  const funnelCounted = funnelSource.data?.length ?? 0

  // Бегущая строка — последние события ленты уведомлений (решение 79).
  const feed = useResource<NotificationFeedDto>(
    user.role === 'UNIVERSITY_REP' || isWork ? null : '/api/notifications?limit=12',
  )
  const tickerItems: TickerItem[] = useMemo(
    () =>
      (feed.data?.items ?? []).map((item) => ({
        key: item.id,
        text: item.description ? `${item.title} · ${item.description}` : item.title,
        href: notificationHref(item.target),
        tone: item.severity === 'critical' ? 'danger' : item.severity === 'warning' ? 'warning' : 'info',
      })),
    [feed.data],
  )

  // Карта: вузы в своих городах, размер точки — число связок.
  const universities = useResource<UniversityListItemDto[]>(
    user.role === 'UNIVERSITY_REP' || isWork ? null : '/api/universities?withRating=false&pageSize=100&sort=name',
  )
  const mapPoints: MapPoint[] = useMemo(
    () =>
      (universities.data ?? []).flatMap((row) => {
        const at = cityCoordinates(row.city)
        if (!at) return []
        return [
          {
            key: row.id,
            label: row.shortName ?? row.name,
            ...at,
            value: row.cooperationCount,
            detail: `${row.city} · ${formatNumber(row.activeCooperationCount)} из ${formatNumber(row.cooperationCount)} связок в работе`,
            href: universityHref(row.id),
          },
        ]
      }),
    [universities.data],
  )
  const offMap = (universities.data?.length ?? 0) - mapPoints.length

  // Связки в работе без просроченных этапов — доля для кольца.
  const cleanShare = useMemo(() => {
    const list = active.data ?? []
    if (list.length === 0) return null
    return Math.round((list.filter((item) => item.progress.overdueStages === 0).length / list.length) * 1000) / 10
  }, [active.data])

  // Презентационный режим (решение 87): графики вместо части списков и одна
  // подсветка вуза на всю главную — наведение на вуз в любом блоке приглушает
  // остальные. В рабочем режиме главная прежняя.
  const showcase = !isWork
  const [focus, setFocus] = useState<string | null>(null)
  const onFocus = showcase ? setFocus : undefined

  // У проблемного этапа нет id вуза — берём его из связок, которые главная уже
  // загрузила; не нашлась — группируем по названию вуза.
  const universityOf = useMemo(() => {
    const map = new Map<string, string>()
    for (const item of [...(funnelSource.data ?? []), ...(active.data ?? [])]) map.set(item.id, item.universityId)
    return (cooperationId: string, universityName: string) => map.get(cooperationId) ?? `name:${universityName}`
  }, [funnelSource.data, active.data])

  // Самые большие дефициты навыков — только для показа, рядом с покрытием.
  const gaps = useResource<SkillGapDto[]>(
    showcase && user.permissions.canSeeAnalytics ? '/api/skills/gaps?limit=5' : null,
  )

  /** Класс приглушения для строки чужого вуза, пока другой вуз подсвечен. */
  const dimFor = (universityId: string) => (focus && focus !== universityId ? styles.dimmed : '')
  /** Наведение на строку подсвечивает её вуз — только в презентационном режиме. */
  const hoverProps = (universityId: string) =>
    showcase
      ? { onPointerEnter: () => setFocus(universityId), onPointerLeave: () => setFocus(null) }
      : {}

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
    trend: metric.trend ?? null,
    isShare: metric.unit === '%',
  }))

  const activeTotal = data?.metrics.find((metric) => metric.key === 'activeCooperations')?.value ?? null

  return (
    <>
      <PageHeader
        scramble
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
          {!isWork && <Ticker items={tickerItems} label="Последние события" />}

          <LiveRail
            numbers={numbers}
            cooperations={cooperations}
            problemTotal={data.problemStageTotal}
            generatedAt={data.generatedAt}
            showcase={showcase}
            focus={focus}
            onFocus={onFocus}
          />

          {/* Бенто: здоровье портфеля кольцами и вузы на карте (решение 79). Только в презентационном режиме. */}
          {!isWork && (
            <div className={styles.bento}>
              <div
                className={`${styles.reveal} ${styles.bentoCell}`}
                data-assemble="left"
                style={{ '--delay': '380ms' } as CSSProperties}
              >
                <Section title="Здоровье портфеля" description="Три доли, по которым видно, всё ли идёт по плану.">
                  <div className={styles.rings}>
                    <Ring
                      value={data.metrics.find((metric) => metric.key === 'stagesOnTimePercent')?.value ?? null}
                      label="Этапы в срок"
                      caption="Закрыты до своего срока — из всех закрытых"
                    />
                    <Ring
                      value={cleanShare}
                      label="Связки без просрочек"
                      caption={`Из ${formatNumber(cooperations.length)} связок в работе и черновиков`}
                      tone="cyan"
                      delay={0.15}
                    />
                    <Ring
                      value={data.skillMatch.coveragePercent}
                      label="Покрытие навыков"
                      caption={`Востребованные рынком навыки в программах · ${data.skillMatch.period}`}
                      tone="pink"
                      delay={0.3}
                    />
                  </div>
                </Section>
              </div>
              <div
                className={`${styles.reveal} ${styles.bentoCell}`}
                data-assemble="right"
                style={{ '--delay': '440ms' } as CSSProperties}
              >
                <Section
                  title="Вузы на карте"
                  description="Размер точки — число связок. Щелчок — страница вуза."
                  action={
                    <Button href="/universities" variant="secondary" size="sm" icon="arrowRight" iconPosition="right">
                      Все вузы
                    </Button>
                  }
                >
                  <div className={styles.mapPanel}>
                    <RussiaMap points={mapPoints} label="Вузы на карте России" />
                  </div>
                  {offMap > 0 && (
                    <p className={styles.funnelNote}>
                      Ещё {formatNumber(offMap)} {pluralize(offMap, ['вуз', 'вуза', 'вузов'])} не на карте: для их города
                      нет координат.
                    </p>
                  )}
                </Section>
              </div>
            </div>
          )}

          <div className={styles.focus}>
            <div id="attention" className={styles.reveal} data-assemble="left" style={{ '--delay': isWork ? '160ms' : '410ms' } as CSSProperties}>
              <Section
                title="Требует внимания"
                description={problemSummary(data.problemStageTotal, data.problemCooperations.length)}
                action={
                  <Button href="/cooperations" variant="secondary" size="sm" icon="arrowRight" iconPosition="right">
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
                  <>
                  {showcase && (
                    <DeadlineStrip
                      items={data.problemCooperations.map((row) => ({
                        key: `${row.cooperationId}:${row.stageId ?? row.reason}`,
                        label: `${row.universityShortName ?? row.universityName} — ${row.programName}`,
                        daysOverdue: row.daysOverdue,
                        href: cooperationHref(row.cooperationId, row.stageId),
                        group: universityOf(row.cooperationId, row.universityName),
                      }))}
                      focus={focus}
                      onFocus={setFocus}
                    />
                  )}
                  {/* Лента событий, а не таблица в рамке (07, раздел 10.E): точка
                      на линии времени, связка, этап в записи маршрута, срок. */}
                  <ol className={styles.queue}>
                    {data.problemCooperations.map((row) => (
                      <li
                        key={`${row.cooperationId}:${row.stageId ?? row.reason}`}
                        className={[styles.event, dimFor(universityOf(row.cooperationId, row.universityName))].filter(Boolean).join(' ')}
                        {...hoverProps(universityOf(row.cooperationId, row.universityName))}
                      >
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
                          <span className={styles.eventText}>
                            <span className={styles.eventTitle} data-morph-title>
                              {row.universityShortName ?? row.universityName} — {row.programName}
                            </span>
                            {row.stageNumber !== null && (
                              <span className={styles.eventMeta}>
                                <span className={styles.notation}>{stageNotation(row.stageNumber)}</span>
                                {row.stageTitle}
                              </span>
                            )}
                          </span>
                          {/* Значок внутри ссылки: вся плашка — одна цель для щелчка. */}
                          {row.daysOverdue === null ? (
                            <Badge tone="warning" withDot title={row.reason}>
                              блок
                            </Badge>
                          ) : (
                            <Badge tone="danger" withDot title={row.reason}>
                              {deadlineBadgeText('overdue', row.daysOverdue, true)}
                            </Badge>
                          )}
                        </Link>
                      </li>
                    ))}
                  </ol>
                  </>
                )}
              </Section>
            </div>

            <div className={styles.reveal} data-assemble="right" style={{ '--delay': isWork ? '220ms' : '480ms' } as CSSProperties}>
              <Section
                title="Приоритетные действия"
                description="Открытые рекомендации с наибольшим приоритетом."
                action={
                  <Button href="/recommendations" variant="secondary" size="sm" icon="arrowRight" iconPosition="right">
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

          <div className={styles.reveal} data-assemble="center" style={{ '--delay': '540ms' } as CSSProperties}>
            <Section
              title="Воронка связок"
              description="Сколько связок вуз — программа — продукт дошло до каждой фазы работы. Отменённые не входят."
              action={
                <Button href="/cooperations" variant="secondary" size="sm" icon="arrowRight" iconPosition="right">
                  Все связки
                </Button>
              }
            >
              {funnelSource.isLoading ? (
                <CardsSkeleton count={1} />
              ) : funnelSource.error ? (
                <ErrorState error={funnelSource.error} onRetry={funnelSource.reload} />
              ) : funnelCounted === 0 ? (
                <EmptyState title="Связок пока нет" description="Воронка появится, когда будет заведена первая связка." />
              ) : (
                <>
                  <Funnel steps={funnelSteps} label="Воронка связок по фазам работы" />
                  {funnelTotal !== null && funnelTotal > funnelCounted && (
                    <p className={styles.funnelNote}>
                      Посчитано по {formatNumber(funnelCounted)} связкам из {formatNumber(funnelTotal)}.
                    </p>
                  )}
                </>
              )}
            </Section>
          </div>

          <div className={styles.columns}>
            <div className={styles.reveal} data-assemble="left" style={{ '--delay': '620ms' } as CSSProperties}>
              <Section
                title="Связки в работе"
                description="Вуз — программа — IT-продукт и этап, на котором связка сейчас."
                action={
                  <Button href="/cooperations" variant="secondary" size="sm" icon="arrowRight" iconPosition="right">
                    Все связки
                  </Button>
                }
              >
                {cooperations.length === 0 ? (
                  <EmptyState title="Связок в работе нет" description="Черновиков и связок в работе пока нет." />
                ) : (
                  <ul className={styles.routes}>
                    {cooperations.slice(0, ROUTE_ROWS).map((item, index) => (
                      <li key={item.id} className={dimFor(item.universityId) || undefined} {...hoverProps(item.universityId)}>
                        <Link
                          className={styles.route}
                          href={cooperationHref(item.id)}
                          title={`${item.universityName} → ${item.programName} → ${item.productName ?? 'продукт не выбран'}`}
                          onClick={(event) => startMorph(event.currentTarget, event)}
                        >
                          {/* Две строки вместо одной: в одну вуз, программа и продукт обрезались до 10–15 букв. */}
                          <span className={styles.routeText}>
                            <span className={styles.routeHead}>
                              <span className={styles.routeUni}>{item.universityShortName ?? item.universityName}</span>
                              <span className={styles.routeSep} aria-hidden>
                                —
                              </span>
                              <span className={styles.routeNode} data-morph-title>
                                {item.programName}
                              </span>
                            </span>
                            <span className={[styles.routeProduct, item.productName ? '' : styles.routeMissing].filter(Boolean).join(' ')}>
                              <span className={styles.routeArrow} aria-hidden>
                                →
                              </span>
                              {item.productName ?? 'продукт не выбран'}
                            </span>
                            {showcase && (
                              <span className={styles.chartLine}>
                              <StageBar
                                done={item.progress.completedStages + item.progress.cancelledStages}
                                current={item.currentStage?.stageNumber ?? null}
                                total={item.progress.totalStages}
                                state={
                                  item.progress.overdueStages > 0
                                    ? 'overdue'
                                    : item.progress.blockedStages > 0
                                      ? 'blocked'
                                      : 'ok'
                                }
                                delay={index * 90}
                              />
                              </span>
                            )}
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

            <div className={styles.reveal} data-assemble="right" style={{ '--delay': '700ms' } as CSSProperties}>
              <Section
                title="Ключевые программы"
                description="Верх рейтинга. Балл относительный — программы сравниваются между собой."
                action={
                  <Button href="/analytics" variant="secondary" size="sm" icon="arrowRight" iconPosition="right">
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
                        <li key={row.programId} className={dimFor(row.universityId) || undefined} {...hoverProps(row.universityId)}>
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
                              {showcase && row.score !== null && (
                                <span className={styles.chartLine}>
                                <ScoreBar
                                  parts={row.factors.map((factor) => ({
                                    key: factor.key,
                                    title: factor.title,
                                    contribution: factor.contribution,
                                    value: factor.value,
                                  }))}
                                  delay={index * 120}
                                />
                                </span>
                              )}
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
                {showcase && data.topPrograms.length > 0 && (
                  <ScoreLegend
                    items={(data.topPrograms[0]?.factors ?? []).map((factor) => ({
                      key: factor.key,
                      title: FACTOR_SHORT[factor.key] ?? factor.title,
                    }))}
                  />
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
                  {/* Кольцо покрытия уже есть в бенто выше — здесь то, из чего складывается дефицит. */}
                  {showcase && gaps.data && gaps.data.length > 0 && (
                    <div className={styles.gapsBlock}>
                      <span className={styles.gapsTitle}>Самые большие дефициты · спрос рынка из 100, бирюзой — покрыто</span>
                      <GapBars
                        rows={gaps.data.map((gap) => ({
                          key: gap.skillId,
                          name: gap.name,
                          demand: gap.demandNormalized ?? 0,
                          coverage: gap.coverage,
                          isCritical: gap.isCritical,
                          explanation: gap.explanation,
                        }))}
                      />
                    </div>
                  )}
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
                    <Button href="/analytics?tab=skills" variant="secondary" size="sm" iconPosition="right" icon="arrowRight">
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
