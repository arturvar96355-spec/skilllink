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
  CellText,
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

/**
 * 25 строк на страницу — по решению Артура: реестр должен выглядеть
 * рабочим инструментом, а не витриной. На экране Full HD они видны
 * без прокрутки, на ноутбуке 1440×900 — двадцать.
 */
const PAGE_SIZE = 25

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

  /*
   * Каждая ячейка — в одну строку. Раньше в строке было по два-три этажа:
   * вуз над программой, этап над сроком, полоса над счётчиками, — и на экран
   * влезало шесть связок. Подробности, которые не поместились, видны
   * в подсказке при наведении и, конечно, в карточке связки.
   */
  const columns: Column<CooperationListItemDto>[] = [
    {
      key: 'university',
      title: 'Вуз',
      width: '130px',
      render: (row) => (
        <CellText strong title={row.universityName}>
          {row.universityShortName ?? row.universityName}
        </CellText>
      ),
    },
    {
      key: 'program',
      title: 'Программа · продукт',
      render: (row) => (
        <CellText title={`${row.programName} · ${row.productName ?? 'IT-продукт не выбран'}`}>
          {row.programName}
          <span className={styles.meta}> · {row.productName ?? 'продукт не выбран'}</span>
        </CellText>
      ),
    },
    {
      key: 'stage',
      title: 'Текущий этап',
      render: (row) =>
        row.currentStage ? (
          <span className={styles.inline}>
            <CellText
              title={
                row.currentStage.deadline
                  ? `${row.currentStage.stageNumber}. ${row.currentStage.title} — срок ${formatDate(row.currentStage.deadline)}`
                  : `${row.currentStage.stageNumber}. ${row.currentStage.title}`
              }
            >
              {row.currentStage.stageNumber}. {row.currentStage.title}
            </CellText>
            <DeadlineBadge
              isOverdue={row.currentStage.isOverdue}
              isDueSoon={row.currentStage.isDueSoon}
              daysToDeadline={row.currentStage.daysToDeadline}
              compact
            />
          </span>
        ) : (
          <CellText muted>Все этапы закрыты</CellText>
        ),
    },
    {
      key: 'progress',
      title: 'Прогресс',
      width: '130px',
      render: (row) => (
        <span
          className={styles.inline}
          title={`Закрыто ${row.progress.completedStages} из ${row.progress.totalStages} этапов`}
        >
          <Progress
            value={row.progress.percent}
            withValue
            label="Прогресс связки"
            tone={row.progress.overdueStages > 0 ? 'danger' : 'default'}
          />
        </span>
      ),
    },
    {
      key: 'overdue',
      title: 'Просрочено',
      width: '92px',
      align: 'right',
      render: (row) =>
        row.progress.overdueStages > 0 ? (
          <Badge tone="danger">{row.progress.overdueStages}</Badge>
        ) : row.progress.blockedStages > 0 ? (
          <Badge tone="warning">блок {row.progress.blockedStages}</Badge>
        ) : (
          <span className={styles.meta}>—</span>
        ),
    },
    {
      key: 'responsible',
      title: 'Ответственный',
      width: '150px',
      render: (row) => <CellText muted>{row.responsible.fullName}</CellText>,
    },
    {
      key: 'status',
      title: 'Статус',
      width: '120px',
      sortField: 'status',
      render: (row) => <CooperationStatusBadge status={row.status} />,
    },
    {
      key: 'targetDate',
      title: 'Срок',
      width: '104px',
      sortField: 'targetDate',
      align: 'right',
      render: (row) => (
        <span
          title={
            row.daysToTarget === null
              ? undefined
              : row.daysToTarget < 0
                ? `Прошло ${Math.abs(row.daysToTarget)} дн.`
                : `Через ${formatNumber(row.daysToTarget)} дн.`
          }
        >
          {formatDate(row.targetDate)}
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
            hideLabel
            placeholder="Вуз, программа, продукт, цель"
            icon="search"
            value={search}
            onChange={(event) => changeFilter(() => setSearch(event.target.value))}
          />
        </ToolbarSearch>
        <ToolbarItem>
          <Select
            label="Статус"
            hideLabel
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
