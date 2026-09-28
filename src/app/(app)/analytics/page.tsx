'use client'

import Link from 'next/link'
import { Suspense, useMemo, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import {
  CONFIDENCE_LABELS,
  METRIC_BASIS_LABELS,
  SKILL_LEVEL_LABELS,
  type ProgramListItemDto,
  type RankedProgramDto,
  type SkillDemandDto,
  type SkillDto,
  type SkillGapDto,
  type UniversityListItemDto,
} from '@/shared/contracts'
import {
  Badge,
  Button,
  Card,
  CardsSkeleton,
  Checkbox,
  DataTable,
  EmptyState,
  ErrorState,
  hasActiveFilters,
  Icon,
  Input,
  MeasureBars,
  MockBadge,
  mockMarks,
  NO_DATA,
  PageHeader,
  Progress,
  RemoteSelect,
  ResetFilters,
  ROUTES,
  Section,
  Select,
  TableSkeleton,
  Tabs,
  Toolbar,
  ToolbarItem,
  Tooltip,
  buildQuery,
  formatNumber,
  formatScore,
  programHref,
  programWithUniversityOption,
  universityHref,
  universityShortOption,
  useResource,
  type Column,
  type TabItem,
  formatShare,
  ListTitle,
} from '@/ui'
import { FunnelTab } from './FunnelTab'
import { demandConclusion, demandRows, gapRows, gapsConclusion, ratingConclusion } from './analytics-view'
import { MeetingsHeatmap } from './MeetingsHeatmap'
import { ProductRecommendationsTab } from './ProductRecommendationsTab'
import { StagesTab } from './StagesTab'
import styles from './analytics.module.css'

const TABS: TabItem[] = [
  { key: 'rating', label: 'Рейтинг программ' },
  { key: 'skills', label: 'Навыки и дефициты' },
  { key: 'demand', label: 'Спрос рынка' },
  // Какой IT-продукт какой программе предложить (решение 223).
  { key: 'products', label: 'Рекомендации продуктов' },
  // Переходы между фазами и выбывшие связки (решение 215).
  { key: 'funnel', label: 'Воронка' },
  // Где в процессе возникают проблемы (ТЗ дизайна 26–29.09, п. 4.2).
  { key: 'stages', label: 'Этапы' },
  // Тепловая карта встреч 7×24 (решение 178, п. 7).
  { key: 'meetings', label: 'Встречи' },
]

type TabKey = 'rating' | 'skills' | 'demand' | 'products' | 'funnel' | 'stages' | 'meetings'

function isTabKey(value: string | null): value is TabKey {
  return (
    value === 'rating' ||
    value === 'skills' ||
    value === 'demand' ||
    value === 'products' ||
    value === 'funnel' ||
    value === 'stages' ||
    value === 'meetings'
  )
}

/** Период замера: `2026-Q1` или `2026-03` — та же проверка, что в схеме модуля навыков. */
const PERIOD_PATTERN = /^\d{4}-(Q[1-4]|(0[1-9]|1[0-2]))$/

const PERIOD_HINT = 'Период — в формате 2026-Q1 или 2026-03; пустое поле — последний доступный период.'

/** Доли 0..1 из ответов по навыкам показываются процентами. */
function share(value: number | null): number | null {
  return value === null ? null : value * 100
}

export default function AnalyticsPage() {
  return (
    // useSearchParams требует границы Suspense: без неё страница не пройдёт сборку.
    <Suspense fallback={<CardsSkeleton count={3} />}>
      <AnalyticsView />
    </Suspense>
  )
}

/**
 * Аналитика.
 *
 * Три вкладки — три разных вопроса, и смешивать их нельзя (решение 7):
 * рейтинг отвечает «где набирать людей», дефициты — «чем дополнить обучение»,
 * спрос — «что сейчас просит рынок». Активная вкладка живёт в адресе: на неё
 * ссылается `skillHref()` из поиска и рекомендаций.
 */
function AnalyticsView() {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()

  const tab: TabKey = isTabKey(params.get('tab')) ? (params.get('tab') as TabKey) : 'rating'
  const selectedSkillId = params.get('skill')

  function setParams(changes: Record<string, string | null>) {
    const next = new URLSearchParams(params.toString())
    for (const [key, value] of Object.entries(changes)) {
      if (value === null) next.delete(key)
      else next.set(key, value)
    }
    const rest = next.toString()
    router.replace(rest === '' ? pathname : `${pathname}?${rest}`, { scroll: false })
  }

  return (
    <>
      <PageHeader
        title="Аналитика"
        help={{ topic: 'analytics' }}
        description="Каждая вкладка отвечает на один вопрос: какие программы сильнее, чего не хватает в обучении, что просит рынок, какой продукт куда предложить, где связки выбывают и застревают, когда встречаются с вузами."
        actions={
          // Лист A4 для печати и PDF (решение 97): сводка всего раздела на одной странице.
          <Button href={ROUTES.managerReport} icon="document" variant="secondary">
            Отчёт руководителю
          </Button>
        }
      />

      <Tabs items={TABS} active={tab} onChange={(key) => setParams({ tab: key })} />

      {tab === 'rating' && <RatingTab />}
      {tab === 'skills' && (
        <GapsTab
          selectedSkillId={selectedSkillId}
          onClearSkill={() => setParams({ skill: null })}
        />
      )}
      {tab === 'demand' && <DemandTab />}
      {tab === 'products' && <ProductRecommendationsTab />}
      {tab === 'funnel' && <FunnelTab />}
      {tab === 'stages' && <StagesTab />}
      {tab === 'meetings' && <MeetingsHeatmap />}
    </>
  )
}

const RATING_HINT =
  'Балл от 0 до 100 — относительный: программы сравниваются между собой, 100 — лучшая в выборке. Считается по трём показателям набора: заявки на обучение, обучающиеся, параллельные группы. Полоса — вклад каждого показателя в балл, от тёмного к светлому. Дефициты, готовность вуза и просрочки в балл не входят — это отдельные сигналы. Программы без данных стоят в конце с пометкой «Нет данных»: пустой показатель не считается нулём.'

/** Короткие подписи показателей рейтинга — для строки под составной полосой. */
const FACTOR_SHORT: Record<string, string> = {
  applicationCount: 'заявки',
  studentCount: 'обучающиеся',
  groupCount: 'группы',
}

/* ──────────────────────────── Рейтинг программ ─────────────────────────── */

function RatingTab() {
  const [limit, setLimit] = useState(20)
  const rating = useResource<RankedProgramDto[]>(`/api/analytics/programs?limit=${limit}`, {
    keepPreviousData: true,
  })

  const rows = rating.data ?? []
  const total = rating.meta?.total ?? rows.length
  const marks = mockMarks(rows)

  const columns: Column<RankedProgramDto>[] = [
    {
      key: 'program',
      title: 'Программа',
      // Лента: программа и её вуз строкой пояснения.
      render: (row) => (
        <ListTitle title={row.programName} tooltip={`${row.programName} — ${row.universityName}`} subline={[row.universityName]} />
      ),
    },
    {
      key: 'university',
      title: 'Вуз',
      hideInList: true,
      width: '200px',
      render: (row) => (
        <Link className={styles.link} href={universityHref(row.universityId)} title={row.universityName}>
          <span className={styles.clamp2}>{row.universityName}</span>
        </Link>
      ),
    },
    {
      key: 'score',
      title: 'Балл',
      width: '120px',
      align: 'right',
      render: (row) => (
        <Tooltip text={row.explanation}>
          {row.score === null ? (
            <span className={styles.scoreEmpty}>{NO_DATA}</span>
          ) : (
            <span className={styles.score}>
              {formatScore(row.score)} <span className={styles.unit}>из 100</span>
            </span>
          )}
        </Tooltip>
      ),
    },
    {
      key: 'basis',
      title: 'Основание',
      width: '160px',
      render: (row) => (
        <span className={styles.basis}>
          <span className={styles.basisLabel}>{METRIC_BASIS_LABELS[row.basis]}</span>
          {marks.row(row) && <Badge tone="mock">демо</Badge>}
        </span>
      ),
    },
    {
      key: 'factors',
      title: 'Из чего сложился балл',
      width: '320px',
      render: (row) =>
        row.factors.length === 0 ? (
          <span className={styles.muted}>Показатели набора не заполнены</span>
        ) : (
          // Одна составная полоса вместо трёх: сегмент — вклад показателя в балл
          // из 100, поэтому полоса и есть ответ на «из чего сложился балл».
          // Вес и вклад — в подсказке сегмента; строка стала вдвое ниже.
          <span className={styles.factors}>
            <span
              className={styles.stack}
              role="img"
              aria-label={row.factors
                .map(
                  (factor) =>
                    `${factor.title}: ${formatNumber(factor.value)}, вклад ${
                      factor.contribution === null ? NO_DATA : formatScore(factor.contribution)
                    }`,
                )
                .join('; ')}
            >
              {row.factors.map((factor) =>
                factor.contribution === null || factor.contribution <= 0 ? null : (
                  <span
                    key={factor.key}
                    className={styles.stackPart}
                    data-factor={factor.key}
                    style={{ width: `${Math.min(100, factor.contribution)}%` }}
                    title={`${factor.title}: ${formatNumber(factor.value)} · вес ${formatShare(
                      factor.weight,
                    )} · вклад ${formatScore(factor.contribution)}`}
                  />
                ),
              )}
            </span>
            <span className={styles.stackLegend}>
              {row.factors.map((factor) => (
                <span key={factor.key} className={styles.legendItem} data-factor={factor.key}>
                  {FACTOR_SHORT[factor.key] ?? factor.title}{' '}
                  <span className={styles.legendValue}>
                    {factor.value === null ? 'нет данных' : formatNumber(factor.value)}
                  </span>
                </span>
              ))}
            </span>
          </span>
        ),
    },
  ]

  return (
    <Section
      title="Рейтинг программ"
      description={
        rating.data ? ratingConclusion(rows, total) : 'Какие программы сильнее по набору: заявки, обучающиеся, группы.'
      }
      hint={RATING_HINT}
      action={marks.section ? <MockBadge /> : undefined}
    >
      <Card padding="none" className={styles.registry}>
        {rating.isLoading ? (
          <TableSkeleton rows={6} columns={5} />
        ) : rating.error ? (
          <ErrorState error={rating.error} onRetry={rating.reload} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon="program"
            title="Рейтинг пуст"
            description="Ни у одной программы не заполнены показатели набора: заявки, обучающиеся и группы."
          />
        ) : (
          <DataTable
            rows={rows}
            columns={columns}
            getRowKey={(row) => row.programId}
            getRowHref={(row) => programHref(row.programId)}
            appearance="list"
            isRefreshing={rating.isRefreshing}
            caption="Рейтинг образовательных программ"
          />
        )}
      </Card>

      {total > rows.length && (
        <p className={styles.tail}>
          Показаны {formatNumber(rows.length)} из {formatNumber(total)}.{' '}
          <Button variant="ghost" size="sm" onClick={() => setLimit(200)}>
            Показать все
          </Button>
        </p>
      )}

    </Section>
  )
}

/* ──────────────────────── Навыки и дефициты (skill gap) ─────────────────── */

function GapsTab({
  selectedSkillId,
  onClearSkill,
}: {
  selectedSkillId: string | null
  onClearSkill: () => void
}) {
  const [universityId, setUniversityId] = useState('')
  const [programId, setProgramId] = useState('')
  const [period, setPeriod] = useState('')
  const [criticalOnly, setCriticalOnly] = useState(false)
  const [limit, setLimit] = useState(50)

  // «Показать все» — это подгрузка, а не фильтр, поэтому limit сюда не входит.
  const hasFilters = hasActiveFilters({
    universityId,
    programId,
    period: period.trim(),
    criticalOnly,
  })
  function resetFilters() {
    setUniversityId('')
    setProgramId('')
    setPeriod('')
    setCriticalOnly(false)
  }

  // Некорректный период не отправляется вовсе: сервер ответил бы ошибкой
  // валидации на каждое нажатие клавиши, а человек просто дописывает номер.
  const isPeriodValid = period === '' || PERIOD_PATTERN.test(period.trim())
  const appliedPeriod = period !== '' && isPeriodValid ? period.trim() : undefined

  const gaps = useResource<SkillGapDto[]>(
    `/api/skills/gaps${buildQuery({
      programId: programId || undefined,
      universityId: universityId || undefined,
      period: appliedPeriod,
      criticalOnly: criticalOnly ? 'true' : undefined,
      limit,
    })}`,
    { keepPreviousData: true },
  )

  const rows = gaps.data ?? []
  const total = gaps.meta?.total ?? rows.length
  const marks = mockMarks(rows)
  const selected = selectedSkillId ? rows.find((row) => row.skillId === selectedSkillId) : undefined
  const gapChart = gapRows(rows)

  const columns: Column<SkillGapDto>[] = [
    {
      key: 'skill',
      title: 'Навык',
      render: (row) => (
        <span className={styles.skillCell}>
          <span className={styles.rowTitle}>{row.name}</span>
          <span className={styles.muted}>{row.category}</span>
          <span className={styles.explanation}>{row.explanation}</span>
        </span>
      ),
    },
    {
      key: 'demand',
      title: 'Спрос рынка',
      width: '190px',
      render: (row) => (
        <span className={styles.measure}>
          <span className={styles.measureValue}>{formatNumber(row.demand)}</span>
          <Progress value={share(row.demandNormalized)} label={`Спрос на навык «${row.name}»`} />
        </span>
      ),
    },
    {
      key: 'coverage',
      title: 'Покрытие программой',
      width: '190px',
      render: (row) => (
        <span className={styles.measure}>
          <span className={styles.measureValue}>{formatShare(row.coverage)}</span>
          <Progress value={row.coverage * 100} label={`Покрытие навыка «${row.name}»`} />
          <span className={styles.muted}>
            {row.level === null ? 'В программах нет' : SKILL_LEVEL_LABELS[row.level]}
          </span>
        </span>
      ),
    },
    {
      key: 'gap',
      title: 'Размер дефицита',
      width: '190px',
      render: (row) => (
        <span className={styles.measure}>
          <span className={styles.measureValue}>{formatShare(row.gap)}</span>
          <Progress
            value={row.gap * 100}
            tone={row.isCritical ? 'danger' : row.gap > 0 ? 'warning' : 'default'}
            label={`Дефицит навыка «${row.name}»`}
          />
        </span>
      ),
    },
    {
      key: 'critical',
      title: 'Критичность',
      width: '190px',
      render: (row) => (
        <span className={styles.criticality}>
          {row.isCritical ? (
            <Badge tone="danger" withDot>
              Критичный дефицит
            </Badge>
          ) : (
            <span className={styles.muted}>Не критичен</span>
          )}
          {marks.row(row) && <Badge tone="mock">демо</Badge>}
        </span>
      ),
    },
  ]

  return (
    <Section
      title="Навыки и дефициты"
      description={gaps.data ? gapsConclusion(rows, total) : 'Чего не хватает в обучении по сравнению со спросом рынка.'}
      hint="Дефицит — разрыв между спросом рынка и тем, что даёт обучение: спрос по шкале 0–100 минус покрытие навыка программой (нет навыка — 0, базовый — 34, средний — 67, продвинутый — 100). Критичный (красный) — навык востребован (спрос не ниже 50), а в программе его нет вовсе. Жёлтый — навык есть, но уровень ниже спроса. Без выбранной программы берётся лучший уровень среди всех действующих программ."
      action={marks.section ? <MockBadge /> : undefined}
    >
      <Toolbar note={PERIOD_HINT} actions={hasFilters ? <ResetFilters active onReset={resetFilters} /> : undefined}>
        <ToolbarItem>
          <RemoteSelect<UniversityListItemDto>
            label="Вуз"
            endpoint="/api/universities"
            params={{ withRating: 'false', sort: 'name' }}
            toOption={universityShortOption}
            placeholder="Все вузы"
            value={universityId}
            onValueChange={(value) => {
              setUniversityId(value)
              // Программа принадлежит вузу: после его смены прежний выбор
              // дал бы заведомо пустую выборку.
              setProgramId('')
            }}
          />
        </ToolbarItem>
        <ToolbarItem>
          <RemoteSelect<ProgramListItemDto>
            label="Программа"
            endpoint="/api/programs"
            params={{ universityId: universityId || undefined, sort: 'name' }}
            toOption={
              universityId ? (row) => ({ value: row.id, label: row.name }) : programWithUniversityOption
            }
            placeholder="Все программы"
            value={programId}
            onValueChange={(value) => setProgramId(value)}
          />
        </ToolbarItem>
        <ToolbarItem>
          <Input
            label="Период"
            placeholder="2026-Q1"
            value={period}
            error={isPeriodValid ? null : 'Период должен быть в формате 2026-Q1 или 2026-03'}
            onChange={(event) => setPeriod(event.target.value)}
          />
        </ToolbarItem>
        <ToolbarItem>
          <Checkbox
            label="Только критичные"
            checked={criticalOnly}
            onChange={(event) => setCriticalOnly(event.target.checked)}
          />
        </ToolbarItem>
      </Toolbar>

      {selectedSkillId && (
        <Card muted padding="sm">
          <span className={styles.selectedSkill}>
            <Icon name="skill" size={18} />
            <span className={styles.selectedText}>
              {selected
                ? `Навык из ссылки: ${selected.name}`
                : 'Навык из ссылки не попал в текущую выборку — снимите фильтры или увеличьте период.'}
            </span>
            <Button variant="ghost" size="sm" onClick={onClearSkill}>
              Снять выделение
            </Button>
          </span>
        </Card>
      )}

      {!gaps.isLoading && !gaps.error && rows.length > 0 && gapChart.rows.length > 0 && (
        <Card>
          <MeasureBars
            rows={gapChart.rows}
            max={100}
            label="Где дефицит: навыки с дефицитом, крупнейшие сверху"
            rest={gapChart.rest}
            valueWidth="6rem"
          />
        </Card>
      )}

      <Card padding="none">
        {gaps.isLoading ? (
          <TableSkeleton rows={6} columns={5} />
        ) : gaps.error ? (
          <ErrorState error={gaps.error} onRetry={gaps.reload} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon="skill"
            title="Дефицитов не найдено"
            description={
              criticalOnly
                ? 'Критичных дефицитов нет. Снимите отбор, чтобы увидеть остальные.'
                : hasFilters
                  ? 'По выбранным условиям дефицитов не найдено. Снимите часть фильтров.'
                  : 'За период нет данных о востребованности навыков. Это не значит, что дефицита нет: считать его не из чего.'
            }
            action={hasFilters ? <ResetFilters active onReset={resetFilters} /> : undefined}
          />
        ) : (
          <DataTable
            rows={rows}
            columns={columns}
            getRowKey={(row) => row.skillId}
            selectedKey={selectedSkillId}
            isRefreshing={gaps.isRefreshing}
            caption="Дефицит навыков"
            narrow="stack"
          />
        )}
      </Card>

      {total > rows.length && (
        <p className={styles.tail}>
          Показаны {formatNumber(rows.length)} из {formatNumber(total)}.{' '}
          <Button variant="ghost" size="sm" onClick={() => setLimit(200)}>
            Показать все
          </Button>
        </p>
      )}
    </Section>
  )
}

/* ───────────────────────────── Спрос рынка ─────────────────────────────── */

function DemandTab() {
  const [period, setPeriod] = useState('')
  const [region, setRegion] = useState('')
  const [category, setCategory] = useState('')
  const [limit, setLimit] = useState(50)

  // «Показать все» — это подгрузка, а не фильтр, поэтому limit сюда не входит.
  const hasFilters = hasActiveFilters({ period: period.trim(), region: region.trim(), category })
  function resetFilters() {
    setPeriod('')
    setRegion('')
    setCategory('')
  }

  /**
   * Категории для фильтра берутся из справочника навыков: отдельного
   * эндпоинта категорий нет. Если справочник не поместился на одну страницу,
   * фильтр честно прячется, а не предлагает неполный список.
   */
  const skills = useResource<SkillDto[]>('/api/skills?pageSize=100&sort=category')
  const categoryOptions = useMemo(() => {
    const rows = skills.data ?? []
    const total = skills.meta?.total ?? rows.length
    if (total > rows.length) return null
    return Array.from(new Set(rows.map((row) => row.category)))
      .sort((a, b) => a.localeCompare(b, 'ru'))
      .map((value) => ({ value, label: value }))
  }, [skills.data, skills.meta])

  const isPeriodValid = period === '' || PERIOD_PATTERN.test(period.trim())
  const appliedPeriod = period !== '' && isPeriodValid ? period.trim() : undefined

  const demand = useResource<SkillDemandDto[]>(
    `/api/skills/demand${buildQuery({
      period: appliedPeriod,
      region: region.trim() || undefined,
      category: category || undefined,
      limit,
    })}`,
    { keepPreviousData: true },
  )

  const rows = demand.data ?? []
  const total = demand.meta?.total ?? rows.length
  const marks = mockMarks(rows)
  const demandChart = demandRows(rows)

  const columns: Column<SkillDemandDto>[] = [
    {
      key: 'skill',
      title: 'Навык',
      render: (row) => (
        <span className={styles.skillCell}>
          <span className={styles.rowTitle}>{row.name}</span>
          <span className={styles.muted}>{row.category}</span>
        </span>
      ),
    },
    {
      key: 'period',
      title: 'Период',
      width: '110px',
      render: (row) => <span className={styles.mono}>{row.period}</span>,
    },
    {
      key: 'value',
      title: 'Значение',
      width: '210px',
      render: (row) => (
        <span className={styles.measure}>
          <span className={styles.measureValue}>
            {formatNumber(row.value)} <span className={styles.unit}>{row.unit}</span>
          </span>
          <Progress
            value={share(row.normalized)}
            label={`Спрос на навык «${row.name}» относительно остальных`}
          />
        </span>
      ),
    },
    {
      key: 'region',
      title: 'Регион',
      width: '150px',
      render: (row) => <span className={styles.muted}>{row.region}</span>,
    },
    {
      key: 'source',
      title: 'Источник',
      width: '220px',
      render: (row) => <span className={styles.muted}>{row.source ?? NO_DATA}</span>,
    },
    {
      key: 'confidence',
      title: 'Доверие',
      width: '160px',
      render: (row) => (
        <span className={styles.criticality}>
          <span className={styles.muted}>
            {row.confidence === null ? NO_DATA : CONFIDENCE_LABELS[row.confidence]}
          </span>
          {marks.row(row) && <Badge tone="mock">демо</Badge>}
        </span>
      ),
    },
  ]

  return (
    <Section
      title="Спрос рынка"
      description={demand.data ? demandConclusion(rows) : 'Что сейчас просит рынок: вакансии по навыкам.'}
      hint="Востребованность навыков по данным рыночной статистики — число вакансий за период. Отметка на полосах — медиана по показанным навыкам: с ней сравнивается каждый навык. Полоса в таблице нормируется по всей выборке периода, а не по странице, поэтому не меняется от фильтров. У каждой строки — источник, уровень доверия и признак демо-данных."
      action={marks.section ? <MockBadge /> : undefined}
    >
      <Toolbar note={PERIOD_HINT} actions={hasFilters ? <ResetFilters active onReset={resetFilters} /> : undefined}>
        <ToolbarItem>
          <Input
            label="Период"
            placeholder="2026-Q1"
            value={period}
            error={isPeriodValid ? null : 'Период должен быть в формате 2026-Q1 или 2026-03'}
            onChange={(event) => setPeriod(event.target.value)}
          />
        </ToolbarItem>
        <ToolbarItem>
          <Input
            label="Регион"
            placeholder="Россия"
            value={region}
            onChange={(event) => setRegion(event.target.value)}
          />
        </ToolbarItem>
        {categoryOptions && categoryOptions.length > 1 && (
          <ToolbarItem>
            <Select
              label="Категория"
              placeholder="Все категории"
              value={category}
              onValueChange={(value) => setCategory(value)}
              options={categoryOptions}
            />
          </ToolbarItem>
        )}
      </Toolbar>

      {marks.section && (
        <Card muted padding="sm">
          <span className={styles.warning}>
            <span className={styles.warningIcon}>
              <Icon name="alert" size={18} />
            </span>
            <span className={styles.warningText}>
              Показан демонстрационный набор. Это не подтверждённая статистика рынка:
              автоматического сбора вакансий в системе нет, источник каждой строки указан
              в таблице.
            </span>
          </span>
        </Card>
      )}

      {!demand.isLoading && !demand.error && demandChart.rows.length > 0 && (
        <Card>
          <MeasureBars
            rows={demandChart.rows}
            max={demandChart.max}
            label="Самые востребованные навыки и медиана спроса"
            markerLabel="медиана по показанным навыкам"
            rest={demandChart.rest}
            valueWidth="8.5rem"
          />
        </Card>
      )}

      <Card padding="none">
        {demand.isLoading ? (
          <TableSkeleton rows={6} columns={6} />
        ) : demand.error ? (
          <ErrorState error={demand.error} onRetry={demand.reload} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon="analytics"
            title="Данных о спросе нет"
            description={
              hasFilters
                ? 'За выбранный период, регион или категорию замеров не было. Снимите часть фильтров.'
                : 'Замеров ещё не было.'
            }
            action={hasFilters ? <ResetFilters active onReset={resetFilters} /> : undefined}
          />
        ) : (
          <DataTable
            rows={rows}
            columns={columns}
            getRowKey={(row) => row.skillId}
            isRefreshing={demand.isRefreshing}
            caption="Востребованность навыков на рынке"
            narrow="stack"
          />
        )}
      </Card>

      {total > rows.length && (
        <p className={styles.tail}>
          Показаны {formatNumber(rows.length)} из {formatNumber(total)}.{' '}
          <Button variant="ghost" size="sm" onClick={() => setLimit(200)}>
            Показать все
          </Button>
        </p>
      )}
    </Section>
  )
}
