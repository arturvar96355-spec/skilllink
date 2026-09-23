'use client'

import { useState } from 'react'
import {
  COOPERATION_STATUSES,
  COOPERATION_STATUS_LABELS,
  type CooperationListItemDto,
} from '@/shared/contracts'
import {
  Badge,
  Button,
  Card,
  Checkbox,
  CooperationStatusBadge,
  DataTable,
  DeadlineBadge,
  EmptyState,
  ErrorState,
  Input,
  MockBadge,
  PageHeader,
  Pagination,
  Progress,
  Section,
  Select,
  TableSkeleton,
  Toolbar,
  ToolbarItem,
  ToolbarSearch,
  buildQuery,
  cooperationHref,
  useCurrentUser,
  formatDate,
  formatNumber,
  useDebounced,
  useResource,
  type Column,
} from '@/ui'
import { CreateCooperationModal } from './CreateCooperationModal'
import styles from './cooperations.module.css'

const PAGE_SIZE = 20

/**
 * Реестр связок.
 *
 * Два отдельных фильтра — «с просрочкой» и «заблокированные»: по контракту это
 * разные сигналы, и сваливать их в одно «проблемные» нельзя. Просрочка уже
 * случилась, блокировка — это остановка, у которой есть причина.
 */
export default function CooperationsPage() {
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [onlyOverdue, setOnlyOverdue] = useState(false)
  const [onlyBlocked, setOnlyBlocked] = useState(false)
  const [sort, setSort] = useState('-updatedAt')
  const [page, setPage] = useState(1)
  const user = useCurrentUser()
  const [isCreateOpen, setIsCreateOpen] = useState(false)

  const query = useDebounced(search.trim(), 300)

  const path = `/api/cooperations${buildQuery({
    q: query.length >= 2 ? query : undefined,
    status: status || undefined,
    onlyOverdue: onlyOverdue ? 'true' : undefined,
    onlyBlocked: onlyBlocked ? 'true' : undefined,
    sort,
    page,
    pageSize: PAGE_SIZE,
  })}`
  const cooperations = useResource<CooperationListItemDto[]>(path)

  const rows = cooperations.data ?? []
  const containsMock = rows.some((row) => row.isMock)

  function changeFilter(apply: () => void) {
    apply()
    setPage(1)
  }

  const columns: Column<CooperationListItemDto>[] = [
    {
      key: 'cooperation',
      title: 'Связка',
      render: (row) => (
        <span className={styles.cell}>
          <span className={styles.title}>{row.universityName}</span>
          <span className={styles.meta}>
            {row.programName} · {row.productName ?? 'продукт не выбран'}
          </span>
        </span>
      ),
    },
    {
      key: 'stage',
      title: 'Текущий этап',
      render: (row) =>
        row.currentStage ? (
          <span className={styles.stage}>
            <span className={styles.stageTitle}>
              {row.currentStage.stageNumber}. {row.currentStage.title}
            </span>
            <span className={styles.progressMeta}>
              <DeadlineBadge
                isOverdue={row.currentStage.isOverdue}
                isDueSoon={row.currentStage.isDueSoon}
                daysToDeadline={row.daysToTarget}
              />
              {row.currentStage.deadline && !row.currentStage.isOverdue && !row.currentStage.isDueSoon && (
                <span>срок {formatDate(row.currentStage.deadline)}</span>
              )}
            </span>
          </span>
        ) : (
          <span className={styles.meta}>Все этапы закрыты</span>
        ),
    },
    {
      key: 'progress',
      title: 'Прогресс',
      width: '190px',
      render: (row) => (
        <span className={styles.progress}>
          <Progress
            value={row.progress.percent}
            withValue
            label="Прогресс связки"
            tone={row.progress.overdueStages > 0 ? 'danger' : 'default'}
          />
          <span className={styles.progressMeta}>
            <span>
              {row.progress.completedStages} из {row.progress.totalStages} этапов
            </span>
            {row.progress.overdueStages > 0 && (
              <Badge tone="danger">просрочено {row.progress.overdueStages}</Badge>
            )}
            {row.progress.blockedStages > 0 && (
              <Badge tone="warning">блок {row.progress.blockedStages}</Badge>
            )}
          </span>
        </span>
      ),
    },
    {
      key: 'responsible',
      title: 'Ответственный',
      width: '190px',
      render: (row) => <span className={styles.meta}>{row.responsible.fullName}</span>,
    },
    {
      key: 'status',
      title: 'Статус',
      width: '140px',
      sortField: 'status',
      render: (row) => <CooperationStatusBadge status={row.status} />,
    },
    {
      key: 'targetDate',
      title: 'Контрольная дата',
      width: '160px',
      sortField: 'targetDate',
      render: (row) => (
        <span className={styles.cell}>
          <span className={styles.title}>{formatDate(row.targetDate)}</span>
          {row.daysToTarget !== null && (
            <span className={styles.meta}>
              {row.daysToTarget < 0
                ? `прошло ${Math.abs(row.daysToTarget)} дн.`
                : `через ${formatNumber(row.daysToTarget)} дн.`}
            </span>
          )}
        </span>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title="Сотрудничество"
        description="Связки «вуз — программа — IT-продукт». Каждая проходит четырнадцать этапов."
        meta={containsMock ? <MockBadge /> : undefined}
        actions={
          <>
            <Button
              variant="secondary"
              icon="download"
              href="/api/export?dataset=cooperations"
              external
              title="Все связки в CSV, до 1000 строк. Фильтры на экране не применяются."
            >
              Выгрузить
            </Button>
            {user.permissions.canWrite && (
              <Button variant="primary" icon="plus" onClick={() => setIsCreateOpen(true)}>
                Создать связку
              </Button>
            )}
          </>
        }
      />

      <Toolbar>
        <ToolbarSearch>
          <Input
            label="Поиск"
            placeholder="Вуз, программа, продукт, цель"
            icon="search"
            value={search}
            onChange={(event) => changeFilter(() => setSearch(event.target.value))}
          />
        </ToolbarSearch>
        <ToolbarItem>
          <Select
            label="Статус"
            placeholder="Любой статус"
            value={status}
            onValueChange={(value) => changeFilter(() => setStatus(value))}
            options={COOPERATION_STATUSES.map((value) => ({
              value,
              label: COOPERATION_STATUS_LABELS[value],
            }))}
          />
        </ToolbarItem>
        <ToolbarItem>
          <div className={styles.filters}>
            <Checkbox
              label="С просрочкой"
              checked={onlyOverdue}
              onChange={(event) => changeFilter(() => setOnlyOverdue(event.target.checked))}
            />
            <Checkbox
              label="Заблокированные"
              checked={onlyBlocked}
              onChange={(event) => changeFilter(() => setOnlyBlocked(event.target.checked))}
            />
          </div>
        </ToolbarItem>
      </Toolbar>

      <Section>
        <Card padding="none">
          {cooperations.isLoading ? (
            <TableSkeleton rows={8} columns={6} />
          ) : cooperations.error ? (
            <ErrorState error={cooperations.error} onRetry={cooperations.reload} />
          ) : rows.length === 0 ? (
            <EmptyState
              icon="cooperation"
              title="Связок не найдено"
              description={
                query || status || onlyOverdue || onlyBlocked
                  ? 'По выбранным условиям ничего нет. Снимите часть фильтров.'
                  : 'Ни одной связки ещё не заведено.'
              }
            />
          ) : (
            <>
              <DataTable
                rows={rows}
                columns={columns}
                getRowKey={(row) => row.id}
                getRowHref={(row) => cooperationHref(row.id)}
                sort={sort}
                onSortChange={(next) => changeFilter(() => setSort(next))}
                isRefreshing={cooperations.isRefreshing}
                caption="Реестр связок"
              />
              <Pagination
                page={cooperations.meta?.page ?? page}
                pageSize={cooperations.meta?.pageSize ?? PAGE_SIZE}
                total={cooperations.meta?.total ?? rows.length}
                onPageChange={setPage}
                nouns={['связка', 'связки', 'связок']}
              />
            </>
          )}
        </Card>
      </Section>

      {isCreateOpen && (
        <CreateCooperationModal
          onClose={(created) => {
            setIsCreateOpen(false)
            if (created) cooperations.reload()
          }}
        />
      )}
    </>
  )
}
