'use client'

import { useMemo, useState } from 'react'
import {
  UNIVERSITY_STATUSES,
  UNIVERSITY_STATUS_LABELS,
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
  MockBadge,
  PageHeader,
  Pagination,
  Section,
  Select,
  TableSkeleton,
  Toolbar,
  ToolbarItem,
  ToolbarSearch,
  Tooltip,
  UniversityStatusBadge,
  buildQuery,
  formatDate,
  formatNumber,
  formatScore,
  universityHref,
  useCurrentUser,
  useDebounced,
  useResource,
  type Column,
} from '@/ui'
import { CreateUniversityModal } from './CreateUniversityModal'
import styles from './universities.module.css'

const PAGE_SIZE = 20

/** Пороги фильтра по рейтингу. Балл относительный, поэтому пороги круглые и редкие. */
const RATING_OPTIONS = [
  { value: '', label: 'Любой рейтинг' },
  { value: '25', label: 'От 25' },
  { value: '50', label: 'От 50' },
  { value: '75', label: 'От 75' },
]

/**
 * Реестр вузов.
 *
 * Сортировка по названию идёт по-русски — это делает база с явным правилом
 * сравнения; без него «Уральский» оказался бы выше «Донского». Рейтинг вуза
 * считается в приложении, поэтому сортировка по нему называется отдельно.
 */
export default function UniversitiesPage() {
  const user = useCurrentUser()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [region, setRegion] = useState('')
  const [minRating, setMinRating] = useState('')
  const [sort, setSort] = useState('name')
  const [page, setPage] = useState(1)
  const [isCreateOpen, setIsCreateOpen] = useState(false)

  const query = useDebounced(search.trim(), 300)

  const path = `/api/universities${buildQuery({
    q: query.length >= 2 ? query : undefined,
    status: status || undefined,
    region: region || undefined,
    minRating: minRating || undefined,
    sort,
    page,
    pageSize: PAGE_SIZE,
  })}`
  const universities = useResource<UniversityListItemDto[]>(path)

  /**
   * Список регионов для фильтра.
   *
   * Отдельного справочника регионов в API нет, поэтому значения берутся
   * из самого реестра — одним запросом без расчёта рейтинга. Пока вузов
   * не больше сотни, список полный; если их станет больше, фильтр честно
   * прячется, вместо того чтобы предлагать неполный набор.
   */
  const regionsSource = useResource<UniversityListItemDto[]>(
    '/api/universities?withRating=false&pageSize=100&sort=region',
  )
  const regionOptions = useMemo(() => {
    const rows = regionsSource.data ?? []
    const total = regionsSource.meta?.total ?? rows.length
    if (total > rows.length) return null
    const unique = Array.from(new Set(rows.map((row) => row.region))).sort((a, b) =>
      a.localeCompare(b, 'ru'),
    )
    return unique.map((value) => ({ value, label: value }))
  }, [regionsSource.data, regionsSource.meta])

  const rows = universities.data ?? []
  const containsMock = rows.some((row) => row.isMock)

  function changeFilter(apply: () => void) {
    // Любая смена фильтра возвращает на первую страницу: иначе после сужения
    // выборки человек оказывается на странице, которой больше нет.
    apply()
    setPage(1)
  }

  const columns: Column<UniversityListItemDto>[] = [
    {
      key: 'name',
      title: 'Университет',
      sortField: 'name',
      render: (row) => (
        <span className={styles.name}>
          <Avatar name={row.shortName ?? row.name} kind="entity" size="sm" />
          <span className={styles.nameText}>
            <span className={styles.nameTitle}>{row.name}</span>
            <span className={styles.nameCity}>
              {row.city}
              {row.region !== row.city && ` · ${row.region}`}
            </span>
          </span>
        </span>
      ),
    },
    {
      key: 'status',
      title: 'Статус',
      width: '150px',
      sortField: 'status',
      render: (row) => <UniversityStatusBadge status={row.status} />,
    },
    {
      key: 'rating',
      title: 'Рейтинг',
      width: '130px',
      align: 'right',
      sortField: 'rating',
      render: (row) => {
        if (!row.rating) return <span className={styles.ratingEmpty}>—</span>
        if (row.rating.score === null) {
          return (
            <Tooltip text={row.rating.explanation}>
              <span className={styles.ratingEmpty}>Нет данных</span>
            </Tooltip>
          )
        }
        return (
          <Tooltip text={row.rating.explanation}>
            <span className={styles.rating}>
              <span className={styles.ratingValue}>{formatScore(row.rating.score)}</span>
            </span>
          </Tooltip>
        )
      },
    },
    {
      key: 'programs',
      title: 'Программы',
      width: '120px',
      align: 'right',
      render: (row) => <span className={styles.counts}>{formatNumber(row.programCount)}</span>,
    },
    {
      key: 'cooperations',
      title: 'Связки',
      width: '130px',
      align: 'right',
      render: (row) => (
        <span className={styles.counts}>
          {formatNumber(row.activeCooperationCount)}
          <span className={styles.countsMuted}>из {formatNumber(row.cooperationCount)}</span>
        </span>
      ),
    },
    {
      key: 'updatedAt',
      title: 'Обновлено',
      width: '130px',
      sortField: 'updatedAt',
      render: (row) => <span className={styles.countsMuted}>{formatDate(row.updatedAt)}</span>,
    },
  ]

  return (
    <>
      <PageHeader
        title="Университеты"
        description="Реестр вузов, с которыми ведётся работа. Балл рейтинга сравнивает вузы между собой и складывается из рейтингов их программ."
        meta={containsMock ? <MockBadge /> : undefined}
        actions={
          user.permissions.canWrite ? (
            <Button variant="primary" icon="plus" onClick={() => setIsCreateOpen(true)}>
              Добавить вуз
            </Button>
          ) : undefined
        }
      />

      <Toolbar>
        <ToolbarSearch>
          <Input
            label="Поиск"
            placeholder="Название, город, программа"
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
            options={UNIVERSITY_STATUSES.map((value) => ({
              value,
              label: UNIVERSITY_STATUS_LABELS[value],
            }))}
          />
        </ToolbarItem>
        {regionOptions && regionOptions.length > 1 && (
          <ToolbarItem>
            <Select
              label="Регион"
              placeholder="Любой регион"
              value={region}
              onValueChange={(value) => changeFilter(() => setRegion(value))}
              options={regionOptions}
            />
          </ToolbarItem>
        )}
        {user.permissions.canSeeAnalytics && (
          <ToolbarItem>
            <Select
              label="Рейтинг"
              value={minRating}
              onValueChange={(value) => changeFilter(() => setMinRating(value))}
              options={RATING_OPTIONS}
            />
          </ToolbarItem>
        )}
      </Toolbar>

      <Section>
        <Card padding="none">
          {universities.isLoading ? (
            <TableSkeleton rows={8} columns={6} />
          ) : universities.error ? (
            <ErrorState error={universities.error} onRetry={universities.reload} />
          ) : rows.length === 0 ? (
            <EmptyState
              icon="university"
              title="Вузы не найдены"
              description={
                query || status || region || minRating
                  ? 'По выбранным условиям ничего нет. Снимите часть фильтров.'
                  : 'Реестр пуст: ни одного вуза ещё не заведено.'
              }
            />
          ) : (
            <>
              <DataTable
                rows={rows}
                columns={columns}
                getRowKey={(row) => row.id}
                getRowHref={(row) => universityHref(row.id)}
                sort={sort}
                onSortChange={(next) => changeFilter(() => setSort(next))}
                isRefreshing={universities.isRefreshing}
                caption="Реестр университетов"
              />
              <Pagination
                page={universities.meta?.page ?? page}
                pageSize={universities.meta?.pageSize ?? PAGE_SIZE}
                total={universities.meta?.total ?? rows.length}
                onPageChange={setPage}
                nouns={['вуз', 'вуза', 'вузов']}
              />
            </>
          )}
        </Card>

        {!user.permissions.canSeeAnalytics && (
          <p className={styles.hint}>
            <Badge tone="info">Рейтинг скрыт</Badge> Вашей роли аналитика недоступна, поэтому
            столбец рейтинга пуст.
          </p>
        )}
      </Section>

      {isCreateOpen && (
        <CreateUniversityModal
          onClose={(created) => {
            setIsCreateOpen(false)
            // Новый вуз должен появиться в списке сразу, без перезагрузки страницы.
            if (created) universities.reload()
          }}
        />
      )}
    </>
  )
}
