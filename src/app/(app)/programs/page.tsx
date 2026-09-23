'use client'

import { useState } from 'react'
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
  Badge,
  Button,
  Card,
  CellText,
  DataTable,
  EmptyState,
  ErrorState,
  Input,
  MetricCell,
  MockBadge,
  NO_DATA,
  PageHeader,
  Pagination,
  ProgramStatusBadge,
  RemoteSelect,
  Select,
  TableSkeleton,
  Toolbar,
  ToolbarItem,
  ToolbarSearch,
  buildQuery,
  useCurrentUser,
  formatDate,
  formatNumber,
  programHref,
  universityShortOption,
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

/**
 * 25 строк на страницу — по решению Артура: реестр должен выглядеть
 * рабочим инструментом, а не витриной. На экране Full HD они видны
 * без прокрутки, на ноутбуке 1440×900 — двадцать.
 */
const PAGE_SIZE = 25

const LEVEL_OPTIONS = PROGRAM_LEVELS.map((level) => ({
  value: level,
  label: PROGRAM_LEVEL_LABELS[level],
}))

const STATUS_OPTIONS = PROGRAM_STATUSES.map((status) => ({
  value: status,
  label: PROGRAM_STATUS_LABELS[status],
}))

/** Срок обучения коротко: «48 мес.» — полная форма не помещается в столбец. */
function formatDuration(months: number | null): string {
  if (months === null) return NO_DATA
  return `${formatNumber(months)} мес.`
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

  // Каждая ячейка — в одну строку; вуз — краткое название, полное в подсказке.
  const columns: Column<ProgramListItemDto>[] = [
    {
      key: 'name',
      title: 'Программа',
      sortField: 'name',
      render: (row) => (
        <span className={styles.program}>
          <CellText strong>{row.name}</CellText>
          {row.isMock && <Badge tone="mock">демо</Badge>}
        </span>
      ),
    },
    {
      key: 'university',
      title: 'Вуз',
      width: '120px',
      render: (row) => (
        <CellText muted title={row.universityName}>
          {row.universityShortName ?? row.universityName}
        </CellText>
      ),
    },
    {
      key: 'level',
      title: 'Уровень',
      width: '116px',
      sortField: 'level',
      render: (row) => <CellText>{PROGRAM_LEVEL_LABELS[row.level]}</CellText>,
    },
    {
      key: 'duration',
      title: 'Срок',
      width: '84px',
      render: (row) => (
        <CellText muted={row.durationMonths === null}>{formatDuration(row.durationMonths)}</CellText>
      ),
    },
    {
      key: 'applicationCount',
      title: 'Заявки',
      width: '96px',
      align: 'right',
      sortField: 'applicationCount',
      sortDescFirst: true,
      render: (row) => <MetricCell metric={row.metrics.applicationCount} />,
    },
    {
      key: 'studentCount',
      title: 'Обучающихся',
      width: '112px',
      align: 'right',
      sortField: 'studentCount',
      sortDescFirst: true,
      render: (row) => <MetricCell metric={row.metrics.studentCount} />,
    },
    {
      key: 'skillCount',
      title: 'Навыков',
      width: '84px',
      align: 'right',
      render: (row) => <span className={styles.count}>{formatNumber(row.skillCount)}</span>,
    },
    {
      key: 'cooperationCount',
      title: 'Связок',
      width: '76px',
      align: 'right',
      render: (row) => <span className={styles.count}>{formatNumber(row.cooperationCount)}</span>,
    },
    {
      key: 'status',
      title: 'Статус',
      width: '130px',
      sortField: 'status',
      render: (row) => <ProgramStatusBadge status={row.status} />,
    },
    {
      key: 'updatedAt',
      title: 'Обновлено',
      width: '104px',
      sortField: 'updatedAt',
      sortDescFirst: true,
      align: 'right',
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
          <>
            {/* Если выбран вуз, выгрузка ограничивается им: этот параметр
                эндпоинт понимает, остальные фильтры — нет. */}
            <Button
              variant="secondary"
              icon="download"
              href={`/api/export${buildQuery({ dataset: 'programs', universityId: universityId || undefined })}`}
              external
              title={
                universityId
                  ? 'Программы выбранного вуза в CSV, до 1000 строк.'
                  : 'Все программы в CSV, до 1000 строк. Фильтры на экране не применяются.'
              }
            >
              Выгрузить
            </Button>
            {user.permissions.canWrite && (
              <Button variant="primary" icon="plus" onClick={() => setIsCreateOpen(true)}>
                Создать программу
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
            hideLabel
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
            hideLabel
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
          {/* Рейтинг вузов здесь не нужен — список идёт только в фильтр. */}
          <RemoteSelect<UniversityListItemDto>
            label="Вуз"
            hideLabel
            endpoint="/api/universities"
            params={{ withRating: 'false', sort: 'name' }}
            toOption={universityShortOption}
            placeholder="Все вузы"
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
