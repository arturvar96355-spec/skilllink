'use client'

import Link from 'next/link'
import { useMemo } from 'react'
import { STAGE_PHASE_LABELS, type CooperationListItemDto, type FunnelDroppedDto, type FunnelDto } from '@/shared/contracts'
import {
  Badge,
  Card,
  CardsSkeleton,
  DataTable,
  EmptyState,
  ErrorState,
  MeasureBars,
  MockBadge,
  ROUTES,
  Section,
  TableSkeleton,
  buildQuery,
  formatDate,
  formatNumber,
  pluralize,
  useResource,
  type Column,
} from '@/ui'
import { PHASE_FUNNEL_PATH, phaseFunnel } from '../phase-funnel'
import {
  composition,
  compositionText,
  currentByPhase,
  droppedSummary,
  droppedText,
  funnelConclusion,
  funnelRows,
  sortDropped,
} from './funnel-view'
import styles from './funnel.module.css'

const FUNNEL_HINT =
  'Воронка — те же связки, что на главной: все, кроме отменённых. Связка «дошла до фазы», если её текущий этап не раньше этой фазы: связка на «Внедрении» уже прошла «Привлечение» и «Оформление». Полоса — сколько дошло из всех, над полосой — какая доля перешла из прошлой фазы. Красным — самый узкий переход; переход в «Контроль» с остальными не сравнивается: туда попадают только связки, прошедшие все этапы.'

const DROPPED_HINT =
  'Выбывшие — связки на паузе и отменённые. «Где» — самый дальний этап, до которого связка дошла. «Когда» — у отменённой дата закрытия, у приостановленной — последняя смена статуса; если её нет в журнале, стоит дата последнего движения по этапам со значком «≈». «Причина» — заметка менеджера в карточке связки.'

/**
 * Вкладка «Воронка» (решение 215): переходы между фазами — подписанными полосами,
 * и список выбывших связок: где, когда и почему.
 */
export function FunnelTab() {
  // Одна база с главной: тот же адрес и та же функция подсчёта.
  const source = useResource<CooperationListItemDto[]>(PHASE_FUNNEL_PATH)
  // Выбывшие с этапом, датой и причиной — из воронки сервера.
  const server = useResource<FunnelDto>('/api/analytics/funnel')

  const list = useMemo(() => source.data ?? [], [source.data])
  const steps = useMemo(() => phaseFunnel(list), [list])
  const dropped = useMemo(
    () => sortDropped((server.data?.steps ?? []).flatMap((step) => step.dropped)),
    [server.data],
  )
  // Сводка — по всем выбывшим из агрегатов сервера; `dropped` — превью до 20 на шаг (решение 227).
  const summary = useMemo(() => (server.data ? droppedSummary(server.data) : null), [server.data])
  const droppedTotal = summary?.total ?? 0
  const counts = composition(list)
  const total = source.meta?.total ?? list.length
  const isMock = Boolean(server.data?.isMock) || list.some((item) => item.isMock)
  /** Верхний блок строится из обоих ответов — ошибка любого из них. */
  const funnelError = source.error ?? server.error

  const columns: Column<FunnelDroppedDto>[] = [
    {
      key: 'title',
      title: 'Связка',
      render: (row) => (
        <span className={styles.cell}>
          <Link className={styles.title} href={row.href}>
            {row.title}
          </Link>
          <span>
            <Badge tone="neutral">
              {row.status === 'CANCELLED' ? 'отменена' : 'на паузе'}
            </Badge>
          </span>
        </span>
      ),
    },
    {
      key: 'where',
      title: 'Где выбыла',
      width: '240px',
      render: (row) => (
        <span className={styles.cell}>
          <span className={styles.strong}>
            Этап {row.stageNumber} · {row.stageTitle}
          </span>
          <span className={styles.muted}>фаза «{STAGE_PHASE_LABELS[row.phase]}»</span>
        </span>
      ),
    },
    {
      key: 'when',
      title: 'Когда',
      width: '130px',
      render: (row) =>
        row.stoppedAt === null ? (
          <span className={styles.muted}>Нет данных</span>
        ) : row.stoppedAtBasis === 'last-move' ? (
          <span className={styles.cell}>
            <span className={styles.strong}>≈ {formatDate(row.stoppedAt)}</span>
            <span className={styles.muted}>последнее движение</span>
          </span>
        ) : (
          <span className={styles.strong}>{formatDate(row.stoppedAt)}</span>
        ),
    },
    {
      key: 'reason',
      title: 'Причина',
      width: '34%',
      render: (row) =>
        row.reason ? (
          <span className={styles.reason}>{row.reason}</span>
        ) : (
          <span className={styles.muted}>Причина не записана</span>
        ),
    },
  ]

  return (
    <div className={styles.stack}>
      <Section
        title="Воронка связок"
        description={
          source.data && summary
            ? funnelConclusion(steps, summary)
            : 'Сколько связок дошло до каждой фазы и сколько перешло дальше.'
        }
        hint={FUNNEL_HINT}
        action={isMock ? <MockBadge /> : undefined}
      >
        <Card>
          {source.isLoading || server.isLoading ? (
            <CardsSkeleton count={1} />
          ) : funnelError ? (
            // Блок строится из обоих ответов: без `/api/analytics/funnel` выбывшие
            // превращались в пустой список, и здесь выходило «Отменённые (0)» —
            // ноль вместо ошибки (ревью Codex 17). Ошибку любого — ошибкой.
            <ErrorState
              error={funnelError}
              onRetry={() => {
                if (source.error) source.reload()
                if (server.error) server.reload()
              }}
            />
          ) : list.length === 0 ? (
            <EmptyState icon="cooperation" title="Связок пока нет" description="Воронка появится, когда будет заведена первая связка." />
          ) : (
            <>
              <MeasureBars
                download={{ title: 'Воронка связок', note: 'Сколько связок дошло до каждой фазы и какая доля перешла дальше' }}
                rows={funnelRows(steps, currentByPhase(list), summary?.byPhase ?? new Map())}
                max={steps[0]?.value ?? 0}
                label="Воронка связок по фазам: сколько дошло и какая доля перешла дальше"
                valueWidth="8.5rem"
                labelWidth="9rem"
              />
              <p className={styles.base}>
                {formatNumber(list.length)} {pluralize(list.length, ['связка', 'связки', 'связок'])} в воронке — как на
                главной: {compositionText(counts)}. Отменённые ({formatNumber(summary?.cancelled ?? 0)}) в воронку не входят и
                показаны ниже среди выбывших.
                {total > list.length && ` Посчитано по ${formatNumber(list.length)} связкам из ${formatNumber(total)}.`}
              </p>
            </>
          )}
        </Card>
      </Section>

      <Section
        title="Выбывшие связки"
        description={
          summary ? droppedText(summary) : 'Связки на паузе и отменённые: где, когда и почему.'
        }
        hint={DROPPED_HINT}
      >
        <Card padding="none">
          {server.isLoading ? (
            <TableSkeleton rows={5} columns={4} />
          ) : server.error ? (
            <ErrorState error={server.error} onRetry={server.reload} />
          ) : dropped.length === 0 ? (
            <EmptyState icon="check" title="Выбывших нет" description="Все связки в работе или завершены." />
          ) : (
            <DataTable
              rows={dropped}
              columns={columns}
              getRowKey={(row) => row.cooperationId}
              caption="Выбывшие связки: где, когда и почему"
              narrow="stack"
            />
          )}
        </Card>
        {droppedTotal > dropped.length && (
          <p className={styles.base}>
            Показаны {formatNumber(dropped.length)} из {formatNumber(droppedTotal)}; остальные —{' '}
            <Link className={styles.title} href={`${ROUTES.cooperations}${buildQuery({ status: 'CANCELLED' })}`}>
              в реестре связок
            </Link>
            .
          </p>
        )}
      </Section>
    </div>
  )
}
