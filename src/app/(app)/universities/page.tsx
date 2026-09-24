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
  TagCarousel,
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
  useStoredValue,
  useUiMode,
  usePageInRange,
  type Column,
  ListTitle,
  formatPlace,
} from '@/ui'
import { CreateUniversityModal } from './CreateUniversityModal'
import { UniversityTag } from './UniversityTag'
import { UniversityFacts } from './UniversityFacts'
import { UniversityGraphSheet, type GraphOrigin } from './UniversityGraphSheet'
import styles from './universities.module.css'

/**
 * 25 строк на страницу — по решению Артура: реестр должен выглядеть
 * рабочим инструментом, а не витриной. На экране Full HD они видны
 * без прокрутки, на ноутбуке 1440×900 — двадцать.
 */
const PAGE_SIZE = 25

/**
 * До скольких вузов фильтр по региону собирается из самого реестра.
 * Дальше он прячется: неполный список регионов хуже отсутствующего —
 * человек решит, что других регионов в системе нет.
 */
const REGION_FILTER_LIMIT = 100

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
  // Вид реестра: 3D-бирки (решение 73) или прежняя лента. Выбор запоминается.
  // Пока человек сам не выбирал, вид — по режиму интерфейса (решение 80):
  // в рабочем список, в презентационном бирки.
  const { isWork } = useUiMode()
  const storedView = useStoredValue('skilllink.universities.view')
  const view =
    storedView.value === 'list' || storedView.value === 'cards' ? storedView.value : isWork ? 'list' : 'cards'
  // Щелчок по центральной бирке раскрывает граф связей вуза (решение 79).
  const [graph, setGraph] = useState<GraphOrigin | null>(null)

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
  const universities = useResource<UniversityListItemDto[]>(path, { keepPreviousData: true })
  usePageInRange(page, setPage, universities.meta)

  /**
   * Список регионов для фильтра.
   *
   * Отдельного справочника регионов в API нет, поэтому значения берутся
   * из самого реестра. Пока вузов не больше сотни, список полный; если их
   * станет больше, фильтр честно прячется, вместо того чтобы предлагать
   * неполный набор.
   *
   * Сколько всего вузов, известно из ответа самого реестра — на большой базе
   * справочник не запрашивается вовсе. Раньше он запрашивался всегда
   * и на тысяче вузов стоил лишних трёхсот миллисекунд работы сервера ради
   * фильтра, который всё равно не покажут.
   */
  const totalUniversities = universities.meta?.total ?? null
  const regionsSource = useResource<UniversityListItemDto[]>(
    totalUniversities !== null && totalUniversities <= REGION_FILTER_LIMIT
      ? `/api/universities?withRating=false&pageSize=${REGION_FILTER_LIMIT}&sort=region`
      : null,
  )
  const regionOptions = useMemo(() => {
    const rows = regionsSource.data ?? []
    if (rows.length === 0) return null
    const unique = Array.from(new Set(rows.map((row) => row.region))).sort((a, b) =>
      a.localeCompare(b, 'ru'),
    )
    return unique.map((value) => ({ value, label: value }))
  }, [regionsSource.data])

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
        // Лента: название и одна строка пояснения — сокращение, город с регионом, связки.
        <ListTitle
          leading={<Avatar name={row.shortName ?? row.name} kind="entity" size="sm" />}
          title={row.name}
          tooltip={row.name}
          subline={[
            row.shortName,
            formatPlace(row.city, row.region),
            `${formatNumber(row.activeCooperationCount)} из ${formatNumber(row.cooperationCount)} связок в работе`,
          ]}
        />
      ),
    },
    {
      key: 'city',
      title: 'Город',
      width: '150px',
      sortField: 'city',
      hideInList: true,
      render: (row) => (
        <span className={styles.place} title={formatPlace(row.city, row.region)}>
          {/* Регион — в подсказке: обрывок «Тверская о…» в каждой строке был шумом. */}
          <span className={styles.placeCity}>{row.city}</span>
        </span>
      ),
    },
    {
      key: 'status',
      title: 'Статус',
      width: '140px',
      sortField: 'status',
      render: (row) => <UniversityStatusBadge status={row.status} />,
    },
    {
      key: 'rating',
      title: 'Рейтинг',
      width: '124px',
      align: 'right',
      sortField: 'rating',
      sortDescFirst: true,
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
              {/* Полоска — тот же балл из 100: сильные и слабые видны не читая чисел. */}
              <span className={styles.ratingBar} aria-hidden>
                <span
                  className={styles.ratingFill}
                  style={{ width: `${Math.max(0, Math.min(100, row.rating.score))}%` }}
                />
              </span>
            </span>
          </Tooltip>
        )
      },
    },
    {
      key: 'cooperations',
      title: 'Связки',
      width: '100px',
      align: 'right',
      hideInList: true,
      render: (row) => (
        <span className={styles.counts}>
          <span className={styles.countsValue}>{formatNumber(row.activeCooperationCount)}</span>
          <span className={styles.countsMuted}>из {formatNumber(row.cooperationCount)}</span>
        </span>
      ),
    },
    {
      key: 'updatedAt',
      title: 'Обновлено',
      width: '100px',
      sortField: 'updatedAt',
      sortDescFirst: true,
      render: (row) => <span className={styles.countsMuted}>{formatDate(row.updatedAt)}</span>,
    },
  ]

  return (
    <>
      <PageHeader
        title="Университеты"
        description="Реестр вузов, с которыми ведётся работа. Балл сравнивает вузы между собой."
        meta={containsMock ? <MockBadge /> : undefined}
        actions={
          <>
            {/*
              Выгрузка отдаёт весь реестр, а не то, что осталось после фильтров:
              эндпоинт принимает только ограничение по вузу. Об этом сказано
              в подсказке — иначе человек решит, что фильтр не сработал.
            */}
            <Button
              variant="secondary"
              icon="download"
              href="/api/export?dataset=universities"
              external
              title="Весь реестр в CSV, до 1000 строк. Фильтры на экране не применяются."
            >
              Выгрузить
            </Button>
            {user.permissions.canWrite && (
              <Button variant="primary" icon="plus" onClick={() => setIsCreateOpen(true)}>
                Добавить вуз
              </Button>
            )}
          </>
        }
      />

      <Toolbar>
        <ToolbarItem>
          <div className={styles.viewSwitch} role="group" aria-label="Вид реестра">
            <Button
              size="sm"
              variant={view === 'cards' ? 'primary' : 'secondary'}
              aria-pressed={view === 'cards'}
              onClick={() => storedView.store('cards')}
            >
              Бирки
            </Button>
            <Button
              size="sm"
              variant={view === 'list' ? 'primary' : 'secondary'}
              aria-pressed={view === 'list'}
              onClick={() => storedView.store('list')}
            >
              Список
            </Button>
          </div>
        </ToolbarItem>
        <ToolbarSearch>
          <Input
            label="Поиск"
            hideLabel
            placeholder="Название, город, программа"
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
              hideLabel
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
              hideLabel
              value={minRating}
              onValueChange={(value) => changeFilter(() => setMinRating(value))}
              options={RATING_OPTIONS}
            />
          </ToolbarItem>
        )}
      </Toolbar>

      <Section>
        <Card padding="none" className={styles.registry}>
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
              {view === 'cards' ? (
                <TagCarousel
                  items={rows}
                  getKey={(row) => row.id}
                  getHref={(row) => universityHref(row.id)}
                  getLabel={(row) => row.name}
                  renderTag={(row) => (
                    <UniversityTag row={row} canSeeAnalytics={user.permissions.canSeeAnalytics} />
                  )}
                  label="Вузы"
                  noun={{ previous: 'Предыдущий вуз', next: 'Следующий вуз' }}
                  onOpen={(row, card) => setGraph({ row, card })}
                  renderFacts={(row) => (
                    <UniversityFacts row={row} canSeeAnalytics={user.permissions.canSeeAnalytics} />
                  )}
                  getIndexMeta={(row) => row.shortName ?? row.city}
                />
              ) : (
                <DataTable
                  rows={rows}
                  columns={columns}
                  getRowKey={(row) => row.id}
                  getRowHref={(row) => universityHref(row.id)}
                  appearance="list"
                  sort={sort}
                  onSortChange={(next) => changeFilter(() => setSort(next))}
                  isRefreshing={universities.isRefreshing}
                  caption="Реестр университетов"
                />
              )}
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

      <UniversityGraphSheet
        origin={graph}
        onClose={() => setGraph(null)}
        canSeeAnalytics={user.permissions.canSeeAnalytics}
      />

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
