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
  ResetFilters,
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
  apiPut,
  buildQuery,
  formatDate,
  formatNumber,
  productHref,
  useCurrentUser,
  useDebounced,
  useMutation,
  useResource,
  useToast,
  usePageInRange,
  CellText,
  type BadgeTone,
  type Column,
  ListTitle,
  Avatar,
  pluralize,
} from '@/ui'
import { AddProductSkillModal } from './AddProductSkillModal'
import { ProductFormModal } from './ProductFormModal'
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
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const user = useCurrentUser()

  const query = useDebounced(search)
  const openedProductId = searchParams.get('product')

  const products = useResource<ProductListItemDto[]>(
    `/api/products${buildQuery({ q: query, status, sort, page, pageSize: PAGE_SIZE })}`,
    { keepPreviousData: true },
  )
  usePageInRange(page, setPage, products.meta)

  const rows = products.data ?? []
  const meta = products.meta
  const hasFilters = search.trim() !== '' || status !== ''
  const marks = mockMarks(rows)

  function closeProduct() {
    const next = new URLSearchParams(searchParams.toString())
    next.delete('product')
    const rest = next.toString()
    // Закрытие панели убирает продукт из адреса, но не добавляет запись в историю.
    router.replace(rest === '' ? pathname : `${pathname}?${rest}`, { scroll: false })
  }

  /** Новый продукт сразу открывается в панели: видно, что он заведён и каким. */
  function openProduct(id: string) {
    const next = new URLSearchParams(searchParams.toString())
    next.set('product', id)
    router.replace(`${pathname}?${next.toString()}`, { scroll: false })
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
        // Лента: название и пояснение — категория, версия, навыки.
        <ListTitle
          leading={<Avatar name={row.name} kind="entity" size="sm" />}
          title={row.name}
          tooltip={row.name}
          badge={marks.row(row) ? <Badge tone="mock">демо</Badge> : undefined}
          subline={[
            row.category,
            row.version ? `версия ${row.version}` : null,
            `${formatNumber(row.skillCount)} ${pluralize(row.skillCount, ['навык', 'навыка', 'навыков'])}`,
          ]}
        />
      ),
    },
    {
      key: 'category',
      title: 'Категория',
      hideInList: true,
      sortField: 'category',
      render: (row) => <CellText title={row.category}>{row.category}</CellText>,
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
        actions={
          user.permissions.canWrite ? (
            <Button variant="primary" icon="plus" onClick={() => setIsCreateOpen(true)}>
              Добавить продукт
            </Button>
          ) : undefined
        }
      />

      <Toolbar actions={hasFilters ? <ResetFilters active onReset={resetFilters} /> : undefined}>
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
                <ResetFilters active onReset={resetFilters} />
              ) : user.permissions.canWrite ? (
                <Button variant="primary" icon="plus" onClick={() => setIsCreateOpen(true)}>
                  Добавить продукт
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <Card padding="none" className={styles.registry}>
          <DataTable
            rows={rows}
            columns={columns}
            getRowKey={(row) => row.id}
            getRowHref={(row) => productHref(row.id)}
            appearance="list"
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
        <ProductDrawer
          key={openedProductId}
          productId={openedProductId}
          canEdit={user.permissions.canWrite}
          onClose={closeProduct}
          onSaved={products.reload}
        />
      )}

      {isCreateOpen && (
        <ProductFormModal
          onClose={(saved) => {
            setIsCreateOpen(false)
            if (!saved) return
            products.reload()
            openProduct(saved.id)
          }}
        />
      )}
    </>
  )
}

function ProductDrawer({
  productId,
  canEdit,
  onClose,
  onSaved,
}: {
  productId: string
  canEdit: boolean
  onClose: () => void
  /** Реестр перечитывается после правки: в строке те же название, версия и статус. */
  onSaved: () => void
}) {
  const toast = useToast()
  const product = useResource<ProductDto>(`/api/products/${productId}`)
  const data = product.data
  const [isEditOpen, setIsEditOpen] = useState(false)
  // Навыки продукта (задача «Данные без экрана», пункт 4) — по образцу навыков программы (решение 152).
  const [isAddSkillOpen, setIsAddSkillOpen] = useState(false)
  const [removingSkillId, setRemovingSkillId] = useState<string | null>(null)
  const removeSkill = useMutation(async (skillId: string) => {
    const skills = (data?.skills ?? [])
      .filter((skill) => skill.skillId !== skillId)
      .map((skill) => ({ skillId: skill.skillId, relevance: skill.relevance }))
    const result = await apiPut<ProductDto>(`/api/products/${productId}/skills`, { skills })
    return result.data
  })

  async function onRemoveSkill(skillId: string) {
    setRemovingSkillId(skillId)
    const result = await removeSkill.run(skillId)
    setRemovingSkillId(null)
    if (!result.ok) {
      toast.error(result.error.message)
      return
    }
    toast.success('Навык убран из продукта')
    product.reload()
    onSaved()
  }

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
            <div className={styles.skillsHead}>
              <h3 className={styles.skillsTitle}>Навыки продукта</h3>
              {canEdit && (
                <Button variant="secondary" size="sm" icon="plus" onClick={() => setIsAddSkillOpen(true)}>
                  Добавить навык
                </Button>
              )}
            </div>
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
                    {canEdit && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onRemoveSkill(skill.skillId)}
                        isLoading={removeSkill.isPending && removingSkillId === skill.skillId}
                        disabled={removeSkill.isPending}
                      >
                        Убрать
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className={styles.drawerActions}>
            {canEdit && (
              <Button variant="primary" size="sm" onClick={() => setIsEditOpen(true)}>
                Изменить
              </Button>
            )}
            <Button
              href={`${ROUTES.cooperations}${buildQuery({ productId: data.id })}`}
              variant="secondary"
              size="sm"
              icon="cooperation"
            >
              Связки с этим продуктом
            </Button>
          </div>
        </div>
      ) : null}

      {isEditOpen && data && (
        <ProductFormModal
          product={data}
          onClose={(saved) => {
            setIsEditOpen(false)
            if (!saved) return
            product.reload()
            onSaved()
          }}
        />
      )}

      {isAddSkillOpen && data && (
        <AddProductSkillModal
          productId={productId}
          existingSkills={data.skills}
          onClose={(added) => {
            setIsAddSkillOpen(false)
            if (!added) return
            product.reload()
            onSaved()
          }}
        />
      )}
    </Drawer>
  )
}
