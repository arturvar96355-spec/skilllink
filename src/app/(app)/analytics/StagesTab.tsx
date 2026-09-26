'use client'

import Link from 'next/link'
import { useMemo } from 'react'
import type { FunnelDto, StageDurationDto, StageDurationsDto, WorkflowStageDto } from '@/shared/contracts'
import {
  Badge,
  Button,
  Card,
  CardsSkeleton,
  DataTable,
  EmptyState,
  ErrorState,
  KpiStrip,
  MockBadge,
  ROUTES,
  Section,
  buildQuery,
  cooperationHref,
  formatNumber,
  pluralize,
  useResource,
  type Column,
} from '@/ui'
import styles from './stages.module.css'

/** Этап с полями связки — так отдают `/api/workflow/overdue` и `/api/workflow/blocked`. */
type ProblemStage = WorkflowStageDto & { universityName: string; programName: string; productName: string | null }

const PROBLEM_PAGE = 100
/** Сколько самых проблемных этапов помечать «здесь застревают». */
const HOTSPOTS = 3
/** Самых долгих просрочек в списке — столько, чтобы колонка не перерастала соседнюю. */
const LONGEST = 5

interface StageRow {
  stageNumber: number
  title: string
  inProgress: number | null
  overdue: number
  blocked: number
  duration: StageDurationDto | null
  isHotspot: boolean
}

interface ResponsibleRow {
  id: string
  name: string
  overdue: number
  blocked: number
  worstDays: number | null
}

function days(value: number | null): string {
  return value === null ? 'Нет данных' : `${formatNumber(value)} ${pluralize(value, ['день', 'дня', 'дней'])}`
}

/**
 * Аналитика этапов (ТЗ дизайна 26–29.09, п. 4.2): где возникают проблемы в процессе.
 *
 * Сводит четыре готовых ответа сервера, ничего не пересчитывая сам:
 * воронка по 14 этапам (`/api/analytics/funnel` — сколько сейчас на этапе и сколько
 * выбыло), длительность этапов по Каплану–Мейеру (`/api/analytics/stage-durations` —
 * сколько этап обычно длится и порог застоя), просрочки и блокировки
 * (`/api/workflow/overdue`, `/api/workflow/blocked` — с ответственными).
 */
export function StagesTab() {
  const funnel = useResource<FunnelDto>('/api/analytics/funnel')
  const durations = useResource<StageDurationsDto>('/api/analytics/stage-durations')
  const overdue = useResource<ProblemStage[]>(`/api/workflow/overdue${buildQuery({ pageSize: PROBLEM_PAGE })}`)
  const blocked = useResource<ProblemStage[]>(`/api/workflow/blocked${buildQuery({ pageSize: PROBLEM_PAGE })}`)

  const stageRows = useMemo<StageRow[]>(() => {
    const steps = funnel.data?.steps ?? []
    const byNumber = new Map((durations.data?.stages ?? []).map((stage) => [stage.stageNumber, stage]))
    const count = (list: ProblemStage[] | null, stage: number) =>
      (list ?? []).filter((item) => item.stageNumber === stage).length
    // Этап 14 система закрывает сама (решение 2): застрять на нём нельзя.
    const rows = steps
      .filter((step) => step.fromStage <= 13)
      .map((step) => ({
        stageNumber: step.fromStage,
        title: step.title,
        inProgress: step.inProgress,
        overdue: count(overdue.data, step.fromStage),
        blocked: count(blocked.data, step.fromStage),
        duration: byNumber.get(step.fromStage) ?? null,
        isHotspot: false,
      }))
    const ranked = [...rows]
      .filter((row) => row.overdue + row.blocked > 0)
      .sort((a, b) => b.overdue + b.blocked - (a.overdue + a.blocked))
      .slice(0, HOTSPOTS)
    for (const row of ranked) row.isHotspot = true
    return rows
  }, [funnel.data, durations.data, overdue.data, blocked.data])

  const responsibleRows = useMemo<ResponsibleRow[]>(() => {
    const map = new Map<string, ResponsibleRow>()
    const add = (item: ProblemStage, kind: 'overdue' | 'blocked') => {
      const id = item.responsible?.id ?? 'none'
      const row = map.get(id) ?? {
        id,
        name: item.responsible?.fullName ?? 'Не назначен',
        overdue: 0,
        blocked: 0,
        worstDays: null,
      }
      row[kind] += 1
      if (item.daysToDeadline !== null && item.daysToDeadline < 0) {
        const late = -item.daysToDeadline
        row.worstDays = row.worstDays === null ? late : Math.max(row.worstDays, late)
      }
      map.set(id, row)
    }
    for (const item of overdue.data ?? []) add(item, 'overdue')
    // Заблокированный и просроченный этап — одна проблема, а не две.
    const overdueIds = new Set((overdue.data ?? []).map((item) => item.id))
    for (const item of blocked.data ?? []) if (!overdueIds.has(item.id)) add(item, 'blocked')
    return [...map.values()].sort((a, b) => b.overdue + b.blocked - (a.overdue + a.blocked))
  }, [overdue.data, blocked.data])

  const longest = useMemo(
    () =>
      [...(overdue.data ?? [])]
        .sort((a, b) => (a.daysToDeadline ?? 0) - (b.daysToDeadline ?? 0))
        .slice(0, LONGEST),
    [overdue.data],
  )

  const resources = [funnel, durations, overdue, blocked]
  const failed = resources.find((resource) => resource.error)
  if (failed?.error) return <ErrorState error={failed.error} onRetry={() => resources.forEach((r) => r.reload())} />
  if (resources.some((resource) => resource.isLoading)) return <CardsSkeleton count={3} />

  const inProgress = (funnel.data?.steps ?? []).reduce((sum, step) => sum + step.inProgress, 0)
  const dropped = (funnel.data?.steps ?? []).reduce((sum, step) => sum + step.droppedCount, 0)
  const isMock = Boolean(funnel.data?.isMock || durations.data?.isMock)
  const maxProblems = Math.max(1, ...stageRows.map((row) => row.overdue + row.blocked))

  const stageColumns: Column<StageRow>[] = [
    {
      key: 'stage',
      title: 'Этап',
      render: (row) => (
        <span className={styles.stageCell}>
          <span className={styles.stageNo}>{row.stageNumber}</span>
          <span className={styles.stageTitle}>{row.title}</span>
          {row.isHotspot && <Badge tone="danger">здесь застревают</Badge>}
        </span>
      ),
    },
    {
      key: 'now',
      title: 'Сейчас',
      width: '90px',
      align: 'right',
      render: (row) => <span className={styles.num}>{row.inProgress === null ? '—' : formatNumber(row.inProgress)}</span>,
    },
    {
      key: 'problems',
      title: 'Просрочки · блоки',
      width: '210px',
      render: (row) => (
        <span className={styles.problemCell}>
          <span className={styles.problemBar} aria-hidden>
            <span className={styles.problemOverdue} style={{ flexGrow: row.overdue / maxProblems }} />
            <span className={styles.problemBlocked} style={{ flexGrow: row.blocked / maxProblems }} />
          </span>
          <span className={row.overdue + row.blocked > 0 ? styles.problemText : styles.muted}>
            {formatNumber(row.overdue)} · {formatNumber(row.blocked)}
          </span>
        </span>
      ),
    },
    {
      key: 'median',
      title: 'Обычно',
      width: '120px',
      render: (row) => (
        <span className={styles.durationCell}>
          {days(row.duration?.median ?? null)}
          {row.duration?.status === 'insufficient_data' && <span className={styles.muted}>данных мало</span>}
        </span>
      ),
    },
    {
      key: 'threshold',
      title: 'Застой после',
      width: '130px',
      render: (row) =>
        row.duration ? (
          <span className={styles.durationCell}>
            {days(row.duration.threshold.days)}
            <span className={styles.muted}>{row.duration.threshold.source === 'km' ? 'по данным' : 'норматив'}</span>
          </span>
        ) : (
          <span className={styles.muted}>Нет данных</span>
        ),
    },
  ]

  return (
    <>
      <div className={styles.head}>
        <p className={styles.lead}>
          Где связки задерживаются: сколько их сейчас на каждом этапе, где просрочки и блокировки, сколько этап
          обычно длится и у кого из ответственных накопились проблемы.
        </p>
        {isMock && <MockBadge />}
      </div>

      <KpiStrip
        items={[
          { key: 'now', label: 'На этапах сейчас', value: inProgress, unit: 'связок' },
          { key: 'overdue', label: 'С просрочкой', value: overdue.meta?.total ?? null, unit: 'этапов' },
          { key: 'blocked', label: 'Заблокировано', value: blocked.meta?.total ?? null, unit: 'этапов' },
          { key: 'dropped', label: 'Выбыли', value: dropped, unit: 'связок', explanation: 'Отменённые и приостановленные связки, не прошедшие этап' },
        ]}
      />
      <div className={styles.jump}>
        <Button
          href={`${ROUTES.cooperations}${buildQuery({ onlyOverdue: 'true' })}`}
          variant="secondary"
          size="sm"
          icon="arrowRight"
          iconPosition="right"
        >
          Связки с просрочкой
        </Button>
        <Button
          href={`${ROUTES.cooperations}${buildQuery({ onlyBlocked: 'true' })}`}
          variant="secondary"
          size="sm"
          icon="arrowRight"
          iconPosition="right"
        >
          Заблокированные связки
        </Button>
      </div>

      <Section
        title="Где застревают связки"
        description="Этапы 1–13. «Сейчас» — связки в работе на этапе, без черновиков; просрочки и блокировки — по всем связкам. Красной биркой — три этапа, где их больше всего. «Обычно» — медиана длительности этапа, «застой после» — сколько дней система считает долгим: по истории этапов, а если её мало — по нормативу."
      >
        <Card padding="none">
          <DataTable rows={stageRows} columns={stageColumns} getRowKey={(row) => String(row.stageNumber)} caption="Состояние этапов" />
        </Card>
        <p className={styles.legend}>
          <span className={styles.legendOverdue} aria-hidden /> просрочено
          <span className={styles.legendBlocked} aria-hidden /> заблокировано
        </p>
      </Section>

      <div className={styles.columns}>
        <Section title="Ответственные" description="У кого сейчас просроченные и заблокированные этапы.">
          {responsibleRows.length === 0 ? (
            <EmptyState icon="check" title="Проблемных этапов нет" description="Ни просрочек, ни блокировок." />
          ) : (
            <ul className={styles.people}>
              {responsibleRows.map((row) => (
                <li key={row.id} className={styles.person}>
                  <span className={row.id === 'none' ? styles.personUnassigned : styles.personName}>{row.name}</span>
                  <span className={styles.personCounts}>
                    {row.overdue > 0 && <Badge tone="danger">просрочено {formatNumber(row.overdue)}</Badge>}
                    {row.blocked > 0 && <Badge tone="warning">заблокировано {formatNumber(row.blocked)}</Badge>}
                  </span>
                  <span className={styles.muted}>
                    {row.worstDays === null ? '' : `дольше всех — ${days(row.worstDays)}`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section
          title="Самые долгие просрочки"
          description="Щелчок — этап в карточке связки."
          action={
            <Button
              href={`${ROUTES.cooperations}${buildQuery({ onlyOverdue: 'true' })}`}
              variant="secondary"
              size="sm"
              icon="arrowRight"
              iconPosition="right"
            >
              Все
            </Button>
          }
        >
          {longest.length === 0 ? (
            <EmptyState icon="check" title="Просрочек нет" description="Все этапы в работе укладываются в срок." />
          ) : (
            <ul className={styles.people}>
              {longest.map((item) => (
                <li key={item.id}>
                  <Link className={styles.late} href={cooperationHref(item.cooperationId, item.id)}>
                    <span className={styles.lateTitle}>
                      {item.universityName} — {item.programName}
                    </span>
                    <span className={styles.lateMeta}>
                      Этап {item.stageNumber}: {item.title}
                      {item.responsible ? ` · ${item.responsible.fullName}` : ' · ответственный не назначен'}
                    </span>
                    <Badge tone="danger">−{formatNumber(-(item.daysToDeadline ?? 0))} дн.</Badge>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </>
  )
}
