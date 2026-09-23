'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useState } from 'react'
import {
  PRODUCT_SKILL_RELEVANCE_LABELS,
  PRODUCT_STATUSES,
  PRODUCT_STATUS_LABELS,
  type ProductDto,
  type ProductListItemDto,
  type ProductStatus,
} from '@/shared/contracts'
import {
  Badge,
  Button,
  Card,
  DataTable,
  Drawer,
  EmptyState,
  ErrorState,
  Icon,
  Input,
  MockBadge,
  mockMarks,
  NO_DATA,
  PageHeader,
  Pagination,
  ROUTES,
  Select,
  SkeletonLines,
  TableSkeleton,
  Toolbar,
  ToolbarItem,
  ToolbarSearch,
  buildQuery,
  formatDate,
  formatNumber,
  productHref,
  useDebounced,
  useResource,
  usePageInRange,
  CellText,
  type BadgeTone,
  type Column,
} from '@/ui'
import styles from './products.module.css'

/**
 * Реестр IT-продуктов.
 *
 * Карточка продукта открывается боковой панелью, а не отдельной страницей:
 * так работает ссылка `productHref()`, которой уже пользуется глобальный поиск.
 * Открытый продукт живёт в адресе (`?product=<id>`) — ссылку можно переслать,
 * а «назад» закрывает панель, а не уводит с реестра.
 */

const PAGE_SIZE = 20

const STATUS_OPTIONS = PRODUCT_STATUSES.map((status) => ({
  value: status,
  label: PRODUCT_STATUS_LABELS[status],
}))

/**
 * Значка статуса продукта в дизайн-системе нет, а заводить новый компонент
 * ради одного реестра нельзя (раздел 35): берём общий `Badge` и держим
 * соответствие «статус → цвет» в одном месте, чтобы оно не разошлось
 * между таблицей и боковой панелью.
 */
const STATUS_TONES: Record<ProductStatus, BadgeTone> = {
  PLANNED: 'info',
  ACTIVE: 'success',
  DEPRECATED: 'warning',
}

export default function ProductsPage() {
  // useSearchParams требует границы Suspense: без неё страница не пройдёт сборку.
  return (
    <Suspense fallback={<TableSkeleton rows={8} columns={6} />}>
      <ProductsView />
    </Suspense>
  )
}

function ProductsView() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<ProductStatus | ''>('')
  const [sort, setSort] = useState('name')
  const [page, setPage] = useState(1)

  const query = useDebounced(search)
  const openedProductId = searchParams.get('product')

  const products = useResource<ProductListItemDto[]>(
    `/api/products${buildQuery({ q: query, status, sort, page, pageSize: PAGE_SIZE })}`,
    { keepPreviousData: true },
  )
  usePageInRange(page, setPage, products.meta)

  const rows = products.data ?? []
  const meta = products.meta
  const hasFilters = query !== '' || status !== ''
  const marks = mockMarks(rows)

  function closeProduct() {
    const next = new URLSearchParams(searchParams.toString())
    next.delete('product')
    const rest = next.toString()
    // Закрытие панели убирает продукт из адреса, но не добавляет запись в историю.
    router.replace(rest === '' ? pathname : `${pathname}?${rest}`, { scroll: false })
  }

  function resetFilters() {
    setSearch('')
    setStatus('')
    setPage(1)
  }

  const columns: Column<ProductListItemDto>[] = [
    {
      key: 'name',
      title: 'Продукт',
      sortField: 'name',
      render: (row) => (
        <span className={styles.name}>
          <CellText strong title={row.name}>
            {row.name}
          </CellText>
          {marks.row(row) && <Badge tone="mock">демо</Badge>}
        </span>
      ),
    },
    {
      key: 'category',
      title: 'Категория',
      sortField: 'category',
      render: (row) => <CellText title={row.category}>{row.category}</CellText>,
    },
    {
      key: 'version',
      title: 'Версия',
      width: '90px',
      render: (row) =>
        row.version === null ? (
          <span className={styles.empty}>{NO_DATA}</span>
        ) : (
          <span className={styles.plain}>{row.version}</span>
        ),
    },
    {
      key: 'status',
      title: 'Статус',
      width: '150px',
      sortField: 'status',
      render: (row) => (
        <Badge tone={STATUS_TONES[row.status]} withDot>
          {PRODUCT_STATUS_LABELS[row.status]}
        </Badge>
      ),
    },
    {
      key: 'skillCount',
      title: 'Навыков',
      width: '100px',
      align: 'right',
      render: (row) => <span className={styles.count}>{formatNumber(row.skillCount)}</span>,
    },
    {
      key: 'cooperationCount',
      title: 'Связок',
      width: '100px',
      align: 'right',
      render: (row) => <span className={styles.count}>{formatNumber(row.cooperationCount)}</span>,
    },
    {
      key: 'updatedAt',
      title: 'Обновлено',
      width: '130px',
      sortField: 'updatedAt',
      sortDescFirst: true,
      render: (row) => <span className={styles.plain}>{formatDate(row.updatedAt)}</span>,
    },
  ]

  return (
    <>
      <PageHeader
        title="IT-продукты"
        description="Продукты, которые передаются вузам: версии, навыки и связки."
        meta={marks.section ? <MockBadge /> : undefined}
      />

      <Toolbar>
        <ToolbarSearch>
          <Input
            label="Поиск"
            icon="search"
            placeholder="Название или категория"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value)
              setPage(1)
            }}
          />
        </ToolbarSearch>
        <ToolbarItem>
          <Select
            label="Статус"
            placeholder="Любой"
            options={STATUS_OPTIONS}
            value={status}
            onValueChange={(value) => {
              setStatus(value as ProductStatus | '')
              setPage(1)
            }}
          />
        </ToolbarItem>
      </Toolbar>

      {products.isLoading ? (
        <TableSkeleton rows={8} columns={6} />
      ) : products.error ? (
        <ErrorState error={products.error} onRetry={products.reload} />
      ) : rows.length === 0 ? (
        <Card muted>
          <EmptyState
            icon="product"
            title={hasFilters ? 'Ничего не найдено' : 'Продуктов пока нет'}
            description={
              hasFilters
                ? 'По выбранным условиям продуктов нет. Снимите часть фильтров и попробуйте снова.'
                : 'В реестре ещё нет ни одного IT-продукта.'
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
            getRowHref={(row) => productHref(row.id)}
            selectedKey={openedProductId}
            sort={sort}
            onSortChange={(next) => {
              setSort(next)
              setPage(1)
            }}
            isRefreshing={products.isRefreshing}
            caption="IT-продукты"
          />
          <Pagination
            page={meta?.page ?? page}
            pageSize={meta?.pageSize ?? PAGE_SIZE}
            total={meta?.total ?? rows.length}
            onPageChange={setPage}
            nouns={['продукт', 'продукта', 'продуктов']}
          />
        </Card>
      )}

      {/* Своя копия панели на каждый продукт: иначе при переходе к соседнему
          продукту в ней на мгновение остались бы данные предыдущего. */}
      {openedProductId !== null && (
        <ProductDrawer key={openedProductId} productId={openedProductId} onClose={closeProduct} />
      )}
    </>
  )
}

function ProductDrawer({ productId, onClose }: { productId: string; onClose: () => void }) {
  const product = useResource<ProductDto>(`/api/products/${productId}`)
  const data = product.data

  return (
    <Drawer
      isOpen
      onClose={onClose}
      title={data?.name ?? 'Карточка продукта'}
      description={
        data ? `${data.category}${data.version ? ` · версия ${data.version}` : ''}` : undefined
      }
    >
      {product.isLoading ? (
        <SkeletonLines count={6} />
      ) : product.error ? (
        <ErrorState error={product.error} onRetry={product.reload} />
      ) : data ? (
        <div className={styles.drawer}>
          <div className={styles.drawerHead}>
            <Badge tone={STATUS_TONES[data.status]} withDot>
              {PRODUCT_STATUS_LABELS[data.status]}
            </Badge>
            {data.isMock && <MockBadge />}
          </div>

          <p className={data.description === null ? styles.empty : styles.description}>
            {data.description ?? 'Описание не заполнено.'}
          </p>

          {data.documentationUrl !== null && (
            <a
              className={styles.docLink}
              href={data.documentationUrl}
              target="_blank"
              rel="noreferrer"
            >
              <Icon name="external" size={16} />
              Документация продукта
            </a>
          )}

          <dl className={styles.facts}>
            <div className={styles.fact}>
              <dt className={styles.factLabel}>Версия</dt>
              <dd className={styles.factValue}>{data.version ?? NO_DATA}</dd>
            </div>
            <div className={styles.fact}>
              <dt className={styles.factLabel}>Связок</dt>
              <dd className={styles.factValue}>{formatNumber(data.cooperationCount)}</dd>
            </div>
            <div className={styles.fact}>
              <dt className={styles.factLabel}>Обновлён</dt>
              <dd className={styles.factValue}>{formatDate(data.updatedAt)}</dd>
            </div>
          </dl>

          <div className={styles.skills}>
            <h3 className={styles.skillsTitle}>Навыки продукта</h3>
            {data.skills.length === 0 ? (
              <p className={styles.empty}>Навыки продукта не заданы.</p>
            ) : (
              <ul className={styles.skillList}>
                {data.skills.map((skill) => (
                  <li key={skill.skillId} className={styles.skill}>
                    <span className={styles.skillText}>
                      <span className={styles.skillName}>{skill.name}</span>
                      <span className={styles.skillCategory}>{skill.category}</span>
                    </span>
                    <Badge tone={skill.relevance === 'CORE' ? 'accent' : 'neutral'}>
                      {PRODUCT_SKILL_RELEVANCE_LABELS[skill.relevance]}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <Button
            href={`${ROUTES.cooperations}${buildQuery({ productId: data.id })}`}
            variant="secondary"
            size="sm"
            icon="cooperation"
          >
            Связки с этим продуктом
          </Button>
        </div>
      ) : null}
    </Drawer>
  )
}
