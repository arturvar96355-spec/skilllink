'use client'

import { useMemo, useState } from 'react'
import {
  PROGRAM_LEVELS,
  PROGRAM_LEVEL_LABELS,
  PROGRAM_STATUSES,
  PROGRAM_STATUS_LABELS,
  type ProgramLevel,
  type ProgramListItemDto,
  type ProgramStatus,
  type UniversityListItemDto,
} from '@/shared/contracts'
import {
  Avatar,
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  ErrorState,
  Input,
  MetricValue,
  MockBadge,
  NO_DATA,
  PageHeader,
  Pagination,
  ProgramStatusBadge,
  Select,
  TableSkeleton,
  Toolbar,
  ToolbarItem,
  ToolbarSearch,
  buildQuery,
  useCurrentUser,
  formatDate,
  formatNumber,
  pluralize,
  programHref,
  useDebounced,
  useResource,
  type Column,
} from '@/ui'
import { CreateProgramModal } from './CreateProgramModal'
import styles from './programs.module.css'

/**
 * Реестр образовательных программ (разделы 18–19 шаблона страниц).
 *
 * Фильтры и сортировка целиком на стороне API: список приходит уже отобранным
 * и уже отсортированным. Считать и переупорядочивать страницу на фронте нельзя —
 * тогда сортировка по показателю набора работала бы только внутри 20 видимых
 * строк, а не по всей базе.
 */

const PAGE_SIZE = 20

const LEVEL_OPTIONS = PROGRAM_LEVELS.map((level) => ({
  value: level,
  label: PROGRAM_LEVEL_LABELS[level],
}))

const STATUS_OPTIONS = PROGRAM_STATUSES.map((status) => ({
  value: status,
  label: PROGRAM_STATUS_LABELS[status],
}))

function formatDuration(months: number | null): string {
  if (months === null) return NO_DATA
  return `${formatNumber(months)} ${pluralize(months, ['месяц', 'месяца', 'месяцев'])}`
}

export default function ProgramsPage() {
  const [search, setSearch] = useState('')
  const [level, setLevel] = useState<ProgramLevel | ''>('')
  const [status, setStatus] = useState<ProgramStatus | ''>('')
  const [universityId, setUniversityId] = useState('')
  const [sort, setSort] = useState('-updatedAt')
  const [page, setPage] = useState(1)
  const user = useCurrentUser()
  const [isCreateOpen, setIsCreateOpen] = useState(false)

  const query = useDebounced(search)

  const programs = useResource<ProgramListItemDto[]>(
    `/api/programs${buildQuery({
      q: query,
      level,
      status,
      universityId,
      sort,
      page,
      pageSize: PAGE_SIZE,
      // Архивные программы скрыты по умолчанию: без этого фильтр «В архиве»
      // всегда возвращал бы пустой список.
      includeArchived: status === 'ARCHIVED' ? 'true' : undefined,
    })}`,
  )

  // Рейтинг вузов здесь не нужен — список идёт только в выпадающий фильтр.
  const universities = useResource<UniversityListItemDto[]>(
    '/api/universities?withRating=false&pageSize=100',
  )

  const universityOptions = useMemo(
    () =>
      (universities.data ?? []).map((item) => ({
        value: item.id,
        label: item.shortName ?? item.name,
      })),
    [universities.data],
  )

  const rows = programs.data ?? []
  const meta = programs.meta
  const hasFilters = query !== '' || level !== '' || status !== '' || universityId !== ''
  const containsMockData = rows.some((row) => row.isMock)

  function resetFilters() {
    setSearch('')
    setLevel('')
    setStatus('')
    setUniversityId('')
    setPage(1)
  }

  const columns: Column<ProgramListItemDto>[] = [
    {
      key: 'name',
      title: 'Программа',
      sortField: 'name',
      render: (row) => (
        <span className={styles.program}>
          <Avatar name={row.name} kind="entity" size="sm" />
          <span className={styles.programText}>
            <span className={styles.programName}>
              {row.name}
              {row.isMock && <Badge tone="mock">демо</Badge>}
            </span>
            <span className={styles.programUniversity}>{row.universityName}</span>
          </span>
        </span>
      ),
    },
    {
      key: 'level',
      title: 'Уровень',
      sortField: 'level',
      render: (row) => <span className={styles.plain}>{PROGRAM_LEVEL_LABELS[row.level]}</span>,
    },
    {
      key: 'duration',
      title: 'Длительность',
      render: (row) => (
        <span className={row.durationMonths === null ? styles.empty : styles.plain}>
          {formatDuration(row.durationMonths)}
        </span>
      ),
    },
    {
      key: 'applicationCount',
      title: 'Заявки',
      align: 'right',
      sortField: 'applicationCount',
      render: (row) => <MetricValue metric={row.metrics.applicationCount} />,
    },
    {
      key: 'studentCount',
      title: 'Обучающихся',
      align: 'right',
      sortField: 'studentCount',
      render: (row) => <MetricValue metric={row.metrics.studentCount} />,
    },
    {
      key: 'skillCount',
      title: 'Навыков',
      align: 'right',
      render: (row) => <span className={styles.count}>{formatNumber(row.skillCount)}</span>,
    },
    {
      key: 'cooperationCount',
      title: 'Связок',
      align: 'right',
      render: (row) => <span className={styles.count}>{formatNumber(row.cooperationCount)}</span>,
    },
    {
      key: 'status',
      title: 'Статус',
      sortField: 'status',
      render: (row) => <ProgramStatusBadge status={row.status} />,
    },
    {
      key: 'updatedAt',
      title: 'Обновлено',
      sortField: 'updatedAt',
      render: (row) => <span className={styles.plain}>{formatDate(row.updatedAt)}</span>,
    },
  ]

  return (
    <>
      <PageHeader
        title="Программы"
        description="Образовательные программы вузов: уровень, набор и связи с IT-продуктами."
        meta={containsMockData ? <MockBadge /> : undefined}
        actions={
          user.permissions.canWrite ? (
            <Button variant="primary" icon="plus" onClick={() => setIsCreateOpen(true)}>
              Создать программу
            </Button>
          ) : undefined
        }
      />

      <Toolbar>
        <ToolbarSearch>
          <Input
            label="Поиск"
            icon="search"
            placeholder="Название, код, направление или вуз"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value)
              setPage(1)
            }}
          />
        </ToolbarSearch>
        <ToolbarItem>
          <Select
            label="Уровень"
            placeholder="Любой"
            options={LEVEL_OPTIONS}
            value={level}
            onValueChange={(value) => {
              setLevel(value as ProgramLevel | '')
              setPage(1)
            }}
          />
        </ToolbarItem>
        <ToolbarItem>
          <Select
            label="Статус"
            placeholder="Любой"
            options={STATUS_OPTIONS}
            value={status}
            onValueChange={(value) => {
              setStatus(value as ProgramStatus | '')
              setPage(1)
            }}
          />
        </ToolbarItem>
        <ToolbarItem>
          <Select
            label="Вуз"
            placeholder={universities.error ? 'Список вузов недоступен' : 'Все вузы'}
            options={universityOptions}
            disabled={universityOptions.length === 0}
            value={universityId}
            onValueChange={(value) => {
              setUniversityId(value)
              setPage(1)
            }}
          />
        </ToolbarItem>
      </Toolbar>

      {programs.isLoading ? (
        <TableSkeleton rows={8} columns={6} />
      ) : programs.error ? (
        <ErrorState error={programs.error} onRetry={programs.reload} />
      ) : rows.length === 0 ? (
        <Card muted>
          <EmptyState
            icon="program"
            title={hasFilters ? 'Ничего не найдено' : 'Программ пока нет'}
            description={
              hasFilters
                ? 'По выбранным условиям программ нет. Снимите часть фильтров и попробуйте снова.'
                : 'В реестре ещё нет ни одной образовательной программы.'
            }
            action={
              hasFilters ? (
                <Button icon="refresh" onClick={resetFilters}>
                  Сбросить фильтры
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <Card padding="none">
          <DataTable
            rows={rows}
            columns={columns}
            getRowKey={(row) => row.id}
            getRowHref={(row) => programHref(row.id)}
            sort={sort}
            onSortChange={(next) => {
              setSort(next)
              setPage(1)
            }}
            isRefreshing={programs.isRefreshing}
            caption="Образовательные программы"
          />
          <Pagination
            page={meta?.page ?? page}
            pageSize={meta?.pageSize ?? PAGE_SIZE}
            total={meta?.total ?? rows.length}
            onPageChange={setPage}
            nouns={['программа', 'программы', 'программ']}
          />
        </Card>
      )}

      {isCreateOpen && (
        <CreateProgramModal
          defaultUniversityId={universityId || undefined}
          onClose={(created) => {
            setIsCreateOpen(false)
            if (created) programs.reload()
          }}
        />
      )}
    </>
  )
}
