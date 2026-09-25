'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useMemo } from 'react'
import type { CSSProperties } from 'react'
import Link from 'next/link'
import { STAGE_PHASES, STAGE_PHASE_LABELS } from '@/shared/contracts'
import type {
  CooperationCountsDto,
  CooperationListItemDto,
  DashboardOverviewDto,
  NotificationFeedDto,
  RecommendationGenerationResultDto,
  SkillGapDto,
  UniversityListItemDto,
} from '@/shared/contracts'
import { LiveRail, type RailNumber } from './LiveRail'
import { Finale } from './Finale'
import { phaseFunnel } from './phase-funnel'
import { cityCoordinates } from './city-coordinates'
import {
  Badge,
  Button,
  CardsSkeleton,
  Bars3D,
  CooperationPeek,
  DeadlineStrip,
  Funnel,
  GapBars,
  PeekProvider,
  Pie3D,
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
  ROUTES,
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
  usePeek,
  startMorph,
  type Bars3DGroup,
  type Pie3DSlice,
  type Pie3DTone,
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
 * «7 активных связей (6 в работе, 1 черновик)». Шапка, блок «Связки в работе»
 * и воронка говорят одной разбивкой с сервера (решение 86): раньше меню
 * показывало 8, шапка 7, фильтр 6, и ни одно число не объясняло другое.
 */
function activeBreakdown(counts: CooperationCountsDto): string {
  const head = `${formatNumber(counts.active)} ${pluralize(counts.active, ['активная связь', 'активные связи', 'активных связей'])}`
  if (counts.drafts === 0) return head
  return `${head} (${formatNumber(counts.inWork)} в работе, ${formatNumber(counts.drafts)} ${pluralize(counts.drafts, ['черновик', 'черновика', 'черновиков'])})`
}

/** Из кого сложилась воронка: «8 связок в воронке: 7 активных, 1 завершённая». */
function funnelComposition(counts: CooperationCountsDto): string {
  const parts = [`${formatNumber(counts.active)} ${pluralize(counts.active, ['активная', 'активные', 'активных'])}`]
  if (counts.paused > 0) parts.push(`${formatNumber(counts.paused)} на паузе`)
  if (counts.completed > 0) {
    parts.push(`${formatNumber(counts.completed)} ${pluralize(counts.completed, ['завершённая', 'завершённые', 'завершённых'])}`)
  }
  return `${formatNumber(counts.total)} ${pluralize(counts.total, ['связка', 'связки', 'связок'])} в воронке: ${parts.join(', ')}.`
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
function Dashboard() {
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
            active: row.activeCooperationCount > 0,
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

  // Презентационный режим (решения 94, 95): графики и 3D вместо части списков,
  // при наведении на связку — всплывающая карточка. В рабочем режиме главная прежняя.
  const showcase = !isWork
  const peek = usePeek()

  // Связки по id: у проблемного этапа на главной нет продукта и прогресса —
  // карточке при наведении они берутся из уже загруженных связок.
  const coopById = useMemo(() => {
    const map = new Map<string, CooperationListItemDto>()
    for (const item of [...(funnelSource.data ?? []), ...(active.data ?? [])]) map.set(item.id, item)
    return map
  }, [funnelSource.data, active.data])

  // Самые большие дефициты навыков — только для показа, рядом с покрытием.
  const gaps = useResource<SkillGapDto[]>(
    showcase && user.permissions.canSeeAnalytics ? '/api/skills/gaps?limit=5' : null,
  )

  // Где сейчас связки: фаза текущего этапа; без текущего этапа — все пройдены.
  const phaseSlices: Pie3DSlice[] = useMemo(() => {
    const list = funnelSource.data ?? []
    const tones: Pie3DTone[] = ['violet', 'pink', 'orange', 'cyan', 'warning']
    const slices: Pie3DSlice[] = STAGE_PHASES.map((phase, index) => ({
      key: phase,
      label: STAGE_PHASE_LABELS[phase],
      value: list.filter((item) => item.currentStage?.phase === phase).length,
      tone: tones[index] ?? 'muted',
    }))
    const finished = list.filter((item) => item.currentStage === null).length
    if (finished > 0) slices.push({ key: 'done', label: 'Все этапы пройдены', value: finished, tone: 'success' })
    return slices.filter((slice) => slice.value > 0)
  }, [funnelSource.data])

  // Связки по вузам: сколько идёт спокойно и сколько требует внимания.
  const universityBars: Bars3DGroup[] = useMemo(() => {
    const groups = new Map<string, { item: CooperationListItemDto; calm: number; stuck: number }>()
    for (const item of funnelSource.data ?? []) {
      const entry = groups.get(item.universityId) ?? { item, calm: 0, stuck: 0 }
      if (item.progress.overdueStages > 0 || item.progress.blockedStages > 0) entry.stuck += 1
      else entry.calm += 1
      groups.set(item.universityId, entry)
    }
    return [...groups.values()]
      .sort((a, b) => b.calm + b.stuck - (a.calm + a.stuck))
      .slice(0, 8)
      .map(({ item, calm, stuck }) => ({
        key: item.universityId,
        label: item.universityShortName ?? item.universityName.slice(0, 10),
        title: item.universityName,
        href: universityHref(item.universityId),
        parts: [
          { key: 'calm', label: 'Идут по плану', value: calm, tone: 'violet' as const },
          { key: 'stuck', label: 'Требуют внимания', value: stuck, tone: 'danger' as const },
        ],
      }))
  }, [funnelSource.data])

  /** Всплывающая карточка связки для строки или точки. */
  const coopPeek = (
    cooperationId: string,
    fallback: { university: string; program: string; stage: number | null; stageTitle: string | null },
    daysOverdue: number | null | 'none',
    reason?: string,
  ) =>
    peek(`coop:${cooperationId}:${fallback.stage ?? ''}`, () => {
      const item = coopById.get(cooperationId)
      const state = daysOverdue === 'none' ? (item && item.progress.overdueStages > 0 ? 'overdue' : item && item.progress.blockedStages > 0 ? 'blocked' : 'ok') : daysOverdue === null ? 'blocked' : 'overdue'
      const status =
        daysOverdue === 'none'
          ? state === 'ok'
            ? 'Идёт по плану'
            : state === 'overdue'
              ? `Просрочено этапов: ${item?.progress.overdueStages}`
              : 'Этап заблокирован'
          : daysOverdue === null
            ? `Заблокирован${reason ? ` · ${reason}` : ''}`
            : `Просрочен на ${formatNumber(daysOverdue)} ${pluralize(daysOverdue, ['день', 'дня', 'дней'])}`
      return (
        <CooperationPeek
          university={fallback.university}
          program={fallback.program}
          product={item?.productName ?? null}
          stage={fallback.stage}
          stageTitle={fallback.stageTitle}
          done={item ? item.progress.completedStages + item.progress.cancelledStages : null}
          total={item?.progress.totalStages ?? 13}
          state={state}
          status={status}
        />
      )
    })

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


  return (
    <>
      <PageHeader
        scramble
        title={`${greeting()}, ${firstName}`}
        description={
          data
            ? `Сегодня ${activeBreakdown(data.cooperationCounts)} · ${formatNumber(data.problemStageTotal)} ${pluralize(data.problemStageTotal, ['этап требует', 'этапа требуют', 'этапов требуют'])} внимания`
            : 'Что требует внимания прямо сейчас и что система предлагает сделать.'
        }
        meta={data?.containsMockData ? <MockBadge /> : undefined}
        actions={
          <>
            {user.permissions.canWorkAnalytics && (
              <Button
                icon="refresh"
                onClick={onRegenerate}
                isLoading={regenerate.isPending}
                variant="secondary"
              >
                Пересобрать рекомендации
              </Button>
            )}
            {/* Лист A4 для печати и PDF (решение 97) — всем, кому видна главная. */}
            <Button href={ROUTES.managerReport} icon="document" variant="secondary">
              Отчёт руководителю
            </Button>
          </>
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
          />

          {/*
            Презентационный режим (решения 79, 95): здоровье портфеля — объёмными
            кольцами, где сейчас связки — большим кольцом рядом с картой вузов.
          */}
          {showcase && (
            <>
              <div className={styles.reveal} data-assemble="center" style={{ '--delay': '380ms' } as CSSProperties}>
                <Section title="Здоровье портфеля" description="Три доли, по которым видно, всё ли идёт по плану. Кольцо можно покрутить.">
                  <div className={styles.health}>
                    <HealthPie
                      title="Этапы в срок"
                      short="в срок"
                      caption="Закрыты до своего срока — из всех закрытых"
                      share={data.metrics.find((metric) => metric.key === 'stagesOnTimePercent')?.value ?? null}
                      parts={[
                        { key: 'ontime', label: 'В срок', tone: 'success' },
                        { key: 'late', label: 'С опозданием', tone: 'danger' },
                      ]}
                    />
                    <HealthPie
                      title="Связки без просрочек"
                      short="без просрочек"
                      caption={`Из ${formatNumber(cooperations.length)} связок в работе и черновиков`}
                      share={cleanShare}
                      counts={[
                        cooperations.filter((item) => item.progress.overdueStages === 0).length,
                        cooperations.filter((item) => item.progress.overdueStages > 0).length,
                      ]}
                      parts={[
                        { key: 'clean', label: 'Без просрочек', tone: 'cyan' },
                        { key: 'late', label: 'С просрочкой', tone: 'danger' },
                      ]}
                    />
                    <HealthPie
                      title="Покрытие навыков"
                      short="покрыто"
                      caption={`Востребованные рынком навыки в программах · ${data.skillMatch.period}`}
                      share={data.skillMatch.coveragePercent}
                      counts={
                        data.skillMatch.coveredSkills !== null && data.skillMatch.demandedSkills !== null
                          ? [data.skillMatch.coveredSkills, Math.max(data.skillMatch.demandedSkills - data.skillMatch.coveredSkills, 0)]
                          : undefined
                      }
                      parts={[
                        { key: 'covered', label: 'Покрыто', tone: 'pink' },
                        { key: 'gap', label: 'Дефицит', tone: 'muted' },
                      ]}
                    />
                  </div>
                </Section>
              </div>

              <div className={styles.bento}>
                <div className={`${styles.reveal} ${styles.bentoCell}`} data-assemble="left" style={{ '--delay': '440ms' } as CSSProperties}>
                  <Section title="Где сейчас связки" description="Фаза текущего этапа каждой связки. Наведите на сектор или подпись.">
                    <div className={styles.panel3d}>
                      <Pie3D slices={phaseSlices} label="Связки по фазам работы" centerLabel="связок" size={300} />
                    </div>
                  </Section>
                </div>
                <div className={`${styles.reveal} ${styles.bentoCell}`} data-assemble="right" style={{ '--delay': '500ms' } as CSSProperties}>
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
                      {/* Центр связей — Москва: там ИТ-Школа РТК, к ней сходятся связки. */}
                      <RussiaMap
                        points={mapPoints}
                        label="Вузы на карте России"
                        hub={{ label: 'ИТ-Школа РТК', lat: 55.756, lon: 37.617 }}
                      />
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
            </>
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
                      }))}
                      itemProps={(item) => {
                        const row = data.problemCooperations.find(
                          (candidate) => `${candidate.cooperationId}:${candidate.stageId ?? candidate.reason}` === item.key,
                        )!
                        return coopPeek(
                          row.cooperationId,
                          {
                            university: row.universityShortName ?? row.universityName,
                            program: row.programName,
                            stage: row.stageNumber,
                            stageTitle: row.stageTitle,
                          },
                          row.daysOverdue,
                          row.reason,
                        )
                      }}
                    />
                  )}
                  {/* Лента событий, а не таблица в рамке (07, раздел 10.E): точка
                      на линии времени, связка, этап в записи маршрута, срок. */}
                  <ol className={styles.queue}>
                    {data.problemCooperations.map((row) => (
                      <li
                        key={`${row.cooperationId}:${row.stageId ?? row.reason}`}
                        className={styles.event}
                        {...coopPeek(
                          row.cooperationId,
                          {
                            university: row.universityShortName ?? row.universityName,
                            program: row.programName,
                            stage: row.stageNumber,
                            stageTitle: row.stageTitle,
                          },
                          row.daysOverdue,
                          row.reason,
                        )}
                      >
                        <span
                          className={[styles.eventMark, row.daysOverdue === null ? styles.blocked : ''].filter(Boolean).join(' ')}
                          aria-hidden
                        />
                        <Link
                          className={styles.eventLink}
                          href={cooperationHref(row.cooperationId, row.stageId)}
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
                            <Badge tone="warning" withDot>
                              блок
                            </Badge>
                          ) : (
                            <Badge tone="danger" withDot>
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
                      user.permissions.canWorkAnalytics ? (
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

          {showcase && universityBars.length > 0 && (
            <div className={styles.reveal} data-assemble="center" style={{ '--delay': '520ms' } as CSSProperties}>
              <Section
                title="Связки по вузам"
                description="Высота колонки — число связок вуза, красная часть — сколько из них требует внимания. Щелчок — страница вуза."
              >
                <div className={styles.panel3d}>
                  <Bars3D groups={universityBars} label="Связки по вузам" unit={['связка', 'связки', 'связок']} />
                </div>
              </Section>
            </div>
          )}

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
                  <p className={styles.funnelNote}>{funnelComposition(data.cooperationCounts)}</p>
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
                      <li
                        key={item.id}
                        {...coopPeek(
                          item.id,
                          {
                            university: item.universityShortName ?? item.universityName,
                            program: item.programName,
                            stage: item.currentStage?.stageNumber ?? null,
                            stageTitle: item.currentStage?.title ?? null,
                          },
                          'none',
                        )}
                      >
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
                {/* Список обрезан — сказать, сколько всего, а не выдавать шесть за все. */}
                {data.cooperationCounts.active > Math.min(ROUTE_ROWS, cooperations.length) && (
                  <p className={styles.funnelNote}>
                    Показаны {formatNumber(Math.min(ROUTE_ROWS, cooperations.length))} из{' '}
                    {formatNumber(data.cooperationCounts.active)}, остальные — в реестре связок.
                  </p>
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

          {/* Финал главной (решение 125): сеть SkillLink — только в презентационном режиме. */}
          {showcase && (funnelSource.data?.length ?? 0) > 0 && (
            <div className={styles.reveal} data-assemble="center" style={{ '--delay': '760ms' } as CSSProperties}>
              <Section title="Сеть SkillLink" description="Вузы → программы → навыки → IT-продукты.">
                <Finale cooperations={funnelSource.data ?? []} skills={(gaps.data ?? []).map((gap) => gap.name)} />
              </Section>
            </div>
          )}
        </>
      ) : null}
    </>
  )
}

/**
 * Главная. В презентационном режиме всплывающие карточки при наведении
 * (решение 95) живут в своём слое — он подключается здесь, над содержимым.
 */
export default function DashboardPage() {
  const { isWork } = useUiMode()
  return (
    <PeekProvider enabled={!isWork}>
      <Dashboard />
    </PeekProvider>
  )
}

/**
 * Объёмное кольцо-доля для «Здоровья портфеля»: доля и остаток; если известны
 * количества — сектора по ним (подсказка покажет штуки), иначе по процентам.
 */
function HealthPie({
  title,
  short,
  caption,
  share,
  counts,
  parts,
}: {
  title: string
  /** Короткая подпись в центре кольца — должна уместиться в отверстие. */
  short: string
  caption: string
  share: number | null
  counts?: [number, number]
  parts: [{ key: string; label: string; tone: Pie3DTone }, { key: string; label: string; tone: Pie3DTone }]
}) {
  const values: [number, number] =
    counts ?? (share === null ? [0, 0] : [Math.round(share * 10) / 10, Math.round((100 - share) * 10) / 10])
  return (
    <figure className={styles.healthItem}>
      <Pie3D
        slices={parts.map((part, index) => ({ ...part, value: values[index] ?? 0 }))}
        label={title}
        centerLabel={short}
        centerValue={share === null ? undefined : `${share.toLocaleString('ru-RU', { maximumFractionDigits: 1 })}%`}
        valueSuffix={counts ? '' : '%'}
        size={220}
        thickness={0.6}
      />
      <figcaption className={styles.healthCaption}>
        <strong className={styles.healthTitle}>{title}</strong>
        {caption}
      </figcaption>
    </figure>
  )
}
