'use client'

import { Suspense, useState, type CSSProperties } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  COOPERATION_STATUSES,
  COOPERATION_STATUS_LABELS,
  type CooperationListItemDto,
  type ProductDto,
} from '@/shared/contracts'
import {
  Avatar,
  StaffName,
  Button,
  Card,
  Checkbox,
  CooperationStatusBadge,
  DataTable,
  DeadlineBadge,
  EmptyState,
  ResetFilters,
  useResetUrl,
  ErrorState,
  Input,
  MockBadge,
  HelpHint,
  PageHeader,
  Pagination,
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
  pluralize,
  useDebounced,
  useResource,
  usePageInRange,
  type Column,
  ListTitle,
  DownloadButton,
  formatStageProgress,
  STAGE_PROGRESS_HINT,
} from '@/ui'
import { WORKFLOW_STAGES } from '@/shared/config/workflow.config'
import { CreateCooperationModal } from './CreateCooperationModal'
import styles from './cooperations.module.css'

/**
 * 25 строк на страницу — по решению Артура: реестр должен выглядеть
 * рабочим инструментом, а не витриной. На экране Full HD они видны
 * без прокрутки, на ноутбуке 1440×900 — двадцать.
 */
const PAGE_SIZE = 25
/** Этапов у связки — отбор ?stage= принимает только их номера. */
const STAGE_COUNT = WORKFLOW_STAGES.length
/** Сколько связок в работе берётся для отбора по этапу: больше API за раз не отдаёт. */
const STAGE_POOL = 100
const STAGE_TITLES = new Map(WORKFLOW_STAGES.map((item) => [item.number, item.title]))

/**
 * Реестр связок.
 *
 * Два отдельных фильтра — «с просрочкой» и «заблокированные»: по контракту это
 * разные сигналы, и сваливать их в одно «проблемные» нельзя. Просрочка уже
 * случилась, блокировка — это остановка, у которой есть причина.
 */
/** Номер этапа в записи маршрута: «06 / 14» (07, раздел 30). */
function stageNotation(stage: number): string {
  return `${String(stage).padStart(2, '0')} / 14`
}


type SegmentState = 'done' | 'current' | 'soon' | 'blocked' | 'late' | 'todo'

/**
 * Лента этапов связки: по сегменту на этап. Закрытые (завершённые
 * и отменённые) — залиты, текущий окрашен своим состоянием. Этапы идут
 * не строго по порядку, поэтому лента показывает, сколько закрыто, а не
 * какие именно, — какие, видно в карточке связки.
 */
function StageTrack({ row }: { row: CooperationListItemDto }) {
  const { progress, currentStage } = row
  const total = Math.max(progress.totalStages, 1)
  const closed = Math.min(progress.completedStages + progress.cancelledStages, total)
  const currentState: SegmentState = !currentStage
    ? 'todo'
    : currentStage.isOverdue
      ? 'late'
      : currentStage.status === 'BLOCKED'
        ? 'blocked'
        : currentStage.isDueSoon
          ? 'soon'
          : 'current'
  const segments = Array.from({ length: total }, (_, index): SegmentState =>
    index < closed ? 'done' : index === closed ? currentState : 'todo',
  )

  return (
    <span
      className={styles.track}
      title={
        `Закрыто ${formatStageProgress(closed, progress.totalStages)} (${STAGE_PROGRESS_HINT})` +
        (progress.overdueStages > 0 ? `, просрочено ${progress.overdueStages}` : '') +
        (progress.blockedStages > 0 ? `, заблокировано ${progress.blockedStages}` : '')
      }
    >
      <span className={styles.segments} aria-hidden>
        {segments.map((state, index) => (
          <span
            key={index}
            className={styles.segment}
            data-state={state}
            style={{ '--i': index } as CSSProperties}
          />
        ))}
      </span>
      <span className={styles.trackMeta}>
        <span className={styles.trackCount}>
          {closed} из {progress.totalStages}
        </span>
        {progress.overdueStages > 0 && (
          <span className={styles.trackLate}>{progress.overdueStages} просроч.</span>
        )}
        {progress.overdueStages === 0 && progress.blockedStages > 0 && (
          <span className={styles.trackBlocked}>{progress.blockedStages} в блоке</span>
        )}
      </span>
    </span>
  )
}

export default function CooperationsPage() {
  return (
    // useSearchParams требует границы Suspense: без неё страница не пройдёт сборку.
    <Suspense fallback={<TableSkeleton rows={8} columns={6} />}>
      <CooperationsView />
    </Suspense>
  )
}

function CooperationsView() {
  const router = useRouter()
  const searchParams = useSearchParams()
  /**
   * Отбор по продукту приходит ссылкой «Связки с этим продуктом» из карточки
   * продукта. Раньше страница параметр не читала и показывала все связки.
   */
  const productId = searchParams.get('productId')
  const product = useResource<ProductDto>(
    productId ? `/api/products/${encodeURIComponent(productId)}` : null,
  )
  const [search, setSearch] = useState('')
  /**
   * Статус, просрочка и блокировка — ссылками с других экранов (решение 153,
   * пробел ТЗ «кликабельные показатели главной»): `?onlyOverdue=true` от плитки
   * «Этапы в срок». Читаются один раз при заходе, как и `productId` выше —
   * страница не держит фильтры в адресе постоянно, только принимает вход по нему.
   */
  const [status, setStatus] = useState(() => {
    const value = searchParams.get('status')
    return value && (COOPERATION_STATUSES as readonly string[]).includes(value) ? value : ''
  })
  /**
   * Отбор по текущему этапу — ссылкой «Все N связок» из панели этапа на главной
   * (решение 211). У API такого фильтра нет — текущий этап вычисляется, а не
   * хранится, — поэтому страница берёт связки в работе той же выборкой, что
   * маршрут на главной (черновики и в работе, до 100), и отбирает этап сама:
   * число строк здесь совпадает с числом на кружке главной.
   */
  const [stage, setStage] = useState<number | null>(() => {
    const value = Number(searchParams.get('stage'))
    return Number.isInteger(value) && value >= 1 && value <= STAGE_COUNT ? value : null
  })
  const [onlyOverdue, setOnlyOverdue] = useState(() => searchParams.get('onlyOverdue') === 'true')
  const [onlyBlocked, setOnlyBlocked] = useState(() => searchParams.get('onlyBlocked') === 'true')
  const [sort, setSort] = useState(() => searchParams.get('sort') || '-updatedAt')
  const [page, setPage] = useState(1)
  const user = useCurrentUser()
  const [isCreateOpen, setIsCreateOpen] = useState(false)

  const query = useDebounced(search.trim(), 300)

  /** Фильтры экрана — общие для реестра и его выгрузки. */
  const listFilters = {
    q: query.length >= 2 ? query : undefined,
    status: status || undefined,
    onlyOverdue: onlyOverdue ? 'true' : undefined,
    onlyBlocked: onlyBlocked ? 'true' : undefined,
    productId: productId ?? undefined,
    sort,
  }
  const path =
    stage === null
      ? `/api/cooperations${buildQuery({ ...listFilters, page, pageSize: PAGE_SIZE })}`
      : `/api/cooperations${buildQuery({ ...listFilters, status: status || ['DRAFT', 'ACTIVE'], page: 1, pageSize: STAGE_POOL })}`
  const cooperations = useResource<CooperationListItemDto[]>(path, { keepPreviousData: true })
  usePageInRange(page, setPage, stage === null ? cooperations.meta : null)

  const fetched = cooperations.data ?? []
  const rows = stage === null ? fetched : fetched.filter((row) => row.currentStage?.stageNumber === stage)
  const stagePoolCut = stage !== null && (cooperations.meta?.total ?? 0) > fetched.length
  const containsMock = rows.some((row) => row.isMock)

  function changeFilter(apply: () => void) {
    apply()
    setPage(1)
  }

  // «Сбросить фильтры» (решение 128): и отбор по продукту из адреса (?productId=).
  const resetUrl = useResetUrl()
  const hasFilters = Boolean(search.trim() || status || onlyOverdue || onlyBlocked || productId || stage)
  function resetFilters() {
    setSearch('')
    setStatus('')
    setStage(null)
    setOnlyOverdue(false)
    setOnlyBlocked(false)
    setPage(1)
    resetUrl(['productId', 'status', 'onlyOverdue', 'onlyBlocked', 'sort', 'stage'])
  }

  /*
   * Каждая ячейка — в одну строку. Раньше в строке было по два-три этажа:
   * вуз над программой, этап над сроком, полоса над счётчиками, — и на экран
   * влезало шесть связок. Подробности, которые не поместились, видны
   * в подсказке при наведении и, конечно, в карточке связки.
   */
  const columns: Column<CooperationListItemDto>[] = [
    {
      // Связка читается маршрутом: вуз — программа, под ними — продукт.
      key: 'route',
      title: 'Связка',
      render: (row) => {
        const university = row.universityShortName ?? row.universityName
        // Лента: вуз — программа, под ними продукт и ответственный.
        return (
          <ListTitle
            leading={<Avatar name={university} kind="entity" size="sm" />}
            title={`${university} — ${row.programName}`}
            tooltip={`${row.universityName} — ${row.programName}`}
            subline={[
              row.productName ? `→ ${row.productName}` : 'продукт не выбран',
              // Строка реестра сама ссылка на связку: аватар есть, своей ссылки нет (решение 230).
              <StaffName key="responsible" id={row.responsible.id} fullName={row.responsible.fullName} link={false} />,
            ]}
          />
        )
      },
    },
    {
      key: 'stage',
      title: 'Текущий этап',
      width: '240px',
      render: (row) =>
        row.currentStage ? (
          <span className={styles.stage}>
            <span className={styles.stageHead}>
              <span className={styles.notation}>{stageNotation(row.currentStage.stageNumber)}</span>
              <DeadlineBadge
                isOverdue={row.currentStage.isOverdue}
                isPlanShifted={row.currentStage.isPlanShifted}
                isDueSoon={row.currentStage.isDueSoon}
                daysToDeadline={row.currentStage.daysToDeadline}
                compact
              />
            </span>
            <span
              className={styles.stageTitle}
              title={
                row.currentStage.deadline
                  ? `${row.currentStage.title} — срок ${formatDate(row.currentStage.deadline)}`
                  : row.currentStage.title
              }
            >
              {row.currentStage.title}
            </span>
          </span>
        ) : (
          <span className={styles.stageDone}>Все этапы закрыты</span>
        ),
    },
    {
      key: 'progress',
      title: 'Прогресс',
      width: '150px',
      render: (row) => <StageTrack row={row} />,
    },
    {
      key: 'status',
      title: 'Статус',
      width: '116px',
      sortField: 'status',
      render: (row) => <CooperationStatusBadge status={row.status} />,
    },
    {
      key: 'targetDate',
      title: 'Срок',
      width: '100px',
      sortField: 'targetDate',
      align: 'right',
      render: (row) => (
        <span
          className={styles.due}
          title={
            row.daysToTarget === null
              ? undefined
              : row.daysToTarget < 0
                ? `Срок прошёл ${formatNumber(Math.abs(row.daysToTarget))} дн. назад`
                : `До срока ${formatNumber(row.daysToTarget)} дн.`
          }
        >
          <span className={styles.dueDate}>{formatDate(row.targetDate)}</span>
          {row.daysToTarget !== null && (
            <span className={row.daysToTarget < 0 ? styles.dueLate : styles.dueNote}>
              {row.daysToTarget < 0
                ? `прошло ${formatNumber(Math.abs(row.daysToTarget))} дн.`
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
        title="Связки"
        description="Связки «вуз — программа — IT-продукт». Каждая проходит четырнадцать этапов."
        // «07 / 14» рядом с «6 из 13» эксперт принял за ошибку (решение 212) — как читать
        // строку, сказано в том же «?», что ведёт в документацию (решение 217).
        help={{
          topic: 'cooperations',
          note: '«07 / 14» — номер текущего этапа из 14. Прогресс считается из 13: последний, «Контроль выполнения», закрывается сам, когда закрыты остальные. «План сдвинут» — срок этапа прошёл, пока шли этапы до него; это не просрочка. «Срок» — плановая дата завершения всей связки.',
        }}
        meta={containsMock ? <MockBadge /> : undefined}
        actions={
          <>
            <DownloadButton
              href={`/api/export${buildQuery({ dataset: 'cooperations', ...listFilters })}`}
              fallbackName="cooperations.csv"
              title="Связки с текущими фильтрами и сортировкой в CSV, до 1000 строк."
            >
              Выгрузить
            </DownloadButton>
            <HelpHint topic="exports" section="registry" />
            {user.permissions.canWrite && (
              <Button variant="primary" icon="plus" onClick={() => setIsCreateOpen(true)}>
                Создать связку
              </Button>
            )}
          </>
        }
      />

      <Toolbar
        help={{ topic: 'navigation', section: 'filters' }}
        actions={hasFilters ? <ResetFilters active onReset={resetFilters} /> : undefined}
      >
        <ToolbarSearch>
          <Input
            label="Поиск"
            hideLabel
            placeholder="Вуз, программа, продукт, ответственный"
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
        {stage !== null && (
          <ToolbarItem>
            <Button
              variant="secondary"
              size="sm"
              icon="close"
              onClick={() => {
                setStage(null)
                resetUrl(['stage'])
              }}
              title="Показать связки на всех этапах"
            >
              {`Этап ${stage}: ${STAGE_TITLES.get(stage) ?? ''}`}
            </Button>
          </ToolbarItem>
        )}
        {productId && (
          <ToolbarItem>
            <Button
              variant="secondary"
              size="sm"
              icon="close"
              onClick={() => router.replace('/cooperations')}
              title="Показать связки всех продуктов"
            >
              {`Продукт: ${product.data?.name ?? '…'}`}
            </Button>
          </ToolbarItem>
        )}
      </Toolbar>

      <Section>
        <Card padding="none" className={styles.registry}>
          {cooperations.isLoading ? (
            <TableSkeleton rows={8} columns={6} />
          ) : cooperations.error ? (
            <ErrorState error={cooperations.error} onRetry={cooperations.reload} />
          ) : rows.length === 0 ? (
            <EmptyState
              icon="cooperation"
              title="Связок не найдено"
              description={
                query || status || onlyOverdue || onlyBlocked || productId || stage
                  ? 'По выбранным условиям ничего нет. Снимите часть фильтров.'
                  : 'Ни одной связки ещё не заведено.'
              }
              action={hasFilters ? <ResetFilters active onReset={resetFilters} /> : undefined}
            />
          ) : (
            <>
              <DataTable
                rows={rows}
                columns={columns}
                getRowKey={(row) => row.id}
                getRowHref={(row) => cooperationHref(row.id)}
                appearance="list"
                sort={sort}
                onSortChange={(next) => changeFilter(() => setSort(next))}
                isRefreshing={cooperations.isRefreshing}
                caption="Реестр связок"
              />
              {stage === null ? (
                <Pagination
                  page={cooperations.meta?.page ?? page}
                  pageSize={cooperations.meta?.pageSize ?? PAGE_SIZE}
                  total={cooperations.meta?.total ?? rows.length}
                  onPageChange={setPage}
                  nouns={['связка', 'связки', 'связок']}
                />
              ) : (
                <p className={styles.stageNote}>
                  {`На этапе ${stage} — ${formatNumber(rows.length)} ${pluralize(rows.length, ['связка', 'связки', 'связок'])}`}
                  {stagePoolCut
                    ? ` (отобраны из первых ${formatNumber(fetched.length)} связок в работе).`
                    : '.'}
                </p>
              )}
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
