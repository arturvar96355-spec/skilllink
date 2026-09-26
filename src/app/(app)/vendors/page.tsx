'use client'

import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useState } from 'react'
import {
  CONTACT_LEGAL_BASIS_LABELS,
  COOPERATION_STATUS_LABELS,
  PRODUCT_STATUS_LABELS,
  VENDOR_CONTACT_CHANNEL_LABELS,
  type VendorDto,
  type VendorListItemDto,
} from '@/shared/contracts'
import {
  Avatar,
  Badge,
  Card,
  DataTable,
  Drawer,
  EmptyState,
  ErrorState,
  Input,
  ListTitle,
  MockBadge,
  PageHeader,
  Pagination,
  ResetFilters,
  SkeletonLines,
  TableSkeleton,
  Toolbar,
  ToolbarSearch,
  buildQuery,
  cooperationHref,
  formatDate,
  formatNumber,
  mockMarks,
  pluralize,
  productHref,
  useDebounced,
  usePageInRange,
  useResource,
  vendorHref,
  type Column,
} from '@/ui'
import styles from './vendors.module.css'

/**
 * Вендоры (ТЗ дизайна 26–29.09, п. 4.5): компании — владельцы IT-продуктов, их
 * продукты, контакты и связки через эти продукты.
 *
 * Поля — только те, что уже есть в API (решение 132, `GET /api/vendors`,
 * `GET /api/vendors/:id`): своих бизнес-полей здесь не придумано. Карточка —
 * боковой панелью, как у IT-продуктов: вендор — справочная запись, и список
 * должен оставаться на месте (решение 155 о формате окон). Открытый вендор
 * живёт в адресе (`?vendor=<id>`).
 */

const PAGE_SIZE = 20

/** «ООО «Базис»» → «Базис»: инициалы аватарки — от названия, а не от правовой формы. */
function brandName(name: string): string {
  const stripped = name.replace(/^(ООО|ОАО|ПАО|АО|ЗАО|ИП|НАО)\s+/u, '').replace(/[«»"]/g, '').trim()
  return stripped || name
}

export default function VendorsPage() {
  return (
    <Suspense fallback={<TableSkeleton rows={8} columns={4} />}>
      <VendorsView />
    </Suspense>
  )
}

function VendorsView() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const query = useDebounced(search)
  const openedId = searchParams.get('vendor')

  const vendors = useResource<VendorListItemDto[]>(
    `/api/vendors${buildQuery({ q: query, page, pageSize: PAGE_SIZE })}`,
    { keepPreviousData: true },
  )
  usePageInRange(page, setPage, vendors.meta)

  const rows = vendors.data ?? []
  const hasFilters = search.trim() !== ''
  const marks = mockMarks(rows)

  function closeVendor() {
    const next = new URLSearchParams(searchParams.toString())
    next.delete('vendor')
    const rest = next.toString()
    router.replace(rest === '' ? pathname : `${pathname}?${rest}`, { scroll: false })
  }

  const columns: Column<VendorListItemDto>[] = [
    {
      key: 'name',
      title: 'Вендор',
      render: (row) => (
        <ListTitle
          leading={<Avatar name={brandName(row.name)} kind="entity" size="sm" />}
          title={row.name}
          tooltip={row.name}
          badge={marks.row(row) ? <Badge tone="mock">демо</Badge> : undefined}
          subline={[
            row.products.length === 0
              ? 'продуктов нет'
              : row.products.map((product) => product.name).join(', '),
          ]}
        />
      ),
    },
    {
      key: 'products',
      title: 'Продуктов',
      width: '110px',
      align: 'right',
      render: (row) => <span className={styles.count}>{formatNumber(row.products.length)}</span>,
    },
    {
      key: 'contacts',
      title: 'Контактов',
      width: '110px',
      align: 'right',
      render: (row) => <span className={styles.count}>{formatNumber(row.contactCount)}</span>,
    },
    {
      key: 'cooperations',
      title: 'Связок',
      width: '100px',
      align: 'right',
      render: (row) => <span className={styles.count}>{formatNumber(row.cooperationCount)}</span>,
    },
  ]

  return (
    <>
      <PageHeader
        title="Вендоры"
        description="Компании — владельцы IT-продуктов: их продукты, контакты и связки с вузами через эти продукты."
        meta={marks.section ? <MockBadge /> : undefined}
      />

      <Toolbar actions={hasFilters ? <ResetFilters active onReset={() => setSearch('')} /> : undefined}>
        <ToolbarSearch>
          <Input
            label="Поиск"
            icon="search"
            placeholder="Название компании"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value)
              setPage(1)
            }}
          />
        </ToolbarSearch>
      </Toolbar>

      {vendors.isLoading ? (
        <TableSkeleton rows={8} columns={4} />
      ) : vendors.error ? (
        <ErrorState error={vendors.error} onRetry={vendors.reload} />
      ) : rows.length === 0 ? (
        <Card muted>
          <EmptyState
            icon="building"
            title={hasFilters ? 'Ничего не найдено' : 'Вендоров пока нет'}
            description={
              hasFilters
                ? 'Компании с таким названием нет. Проверьте написание.'
                : 'Вендоры появляются при загрузке справочника вендоров или вместе с IT-продуктами.'
            }
            action={hasFilters ? <ResetFilters active onReset={() => setSearch('')} /> : undefined}
          />
        </Card>
      ) : (
        <Card padding="none">
          <DataTable
            rows={rows}
            columns={columns}
            getRowKey={(row) => row.id}
            getRowHref={(row) => vendorHref(row.id)}
            appearance="list"
            selectedKey={openedId}
            isRefreshing={vendors.isRefreshing}
            caption="Вендоры"
          />
          <Pagination
            page={vendors.meta?.page ?? page}
            pageSize={vendors.meta?.pageSize ?? PAGE_SIZE}
            total={vendors.meta?.total ?? rows.length}
            onPageChange={setPage}
            nouns={['вендор', 'вендора', 'вендоров']}
          />
        </Card>
      )}

      {/* Своя копия панели на каждого вендора: иначе при переходе к соседнему
          на мгновение остались бы данные прежнего. */}
      {openedId !== null && <VendorDrawer key={openedId} vendorId={openedId} onClose={closeVendor} />}
    </>
  )
}

function VendorDrawer({ vendorId, onClose }: { vendorId: string; onClose: () => void }) {
  const vendor = useResource<VendorDto>(`/api/vendors/${vendorId}`)
  const data = vendor.data

  return (
    <Drawer
      isOpen
      onClose={onClose}
      title={data?.name ?? 'Карточка вендора'}
      description={
        data
          ? `${formatNumber(data.products.length)} ${pluralize(data.products.length, ['продукт', 'продукта', 'продуктов'])} · ${formatNumber(data.cooperations.length)} ${pluralize(data.cooperations.length, ['связка', 'связки', 'связок'])}`
          : undefined
      }
    >
      {vendor.isLoading ? (
        <SkeletonLines count={6} />
      ) : vendor.error ? (
        <ErrorState error={vendor.error} onRetry={vendor.reload} />
      ) : data ? (
        <div className={styles.drawer}>
          {data.isMock && (
            <div>
              <MockBadge />
            </div>
          )}

          <section className={styles.block}>
            <h3 className={styles.blockTitle}>Продукты</h3>
            {data.products.length === 0 ? (
              <p className={styles.empty}>Продукты вендора не заведены.</p>
            ) : (
              <ul className={styles.list}>
                {data.products.map((product) => (
                  <li key={product.id}>
                    <Link className={styles.row} href={productHref(product.id)}>
                      <span className={styles.rowMain}>
                        <span className={styles.rowTitle}>{product.name}</span>
                        <span className={styles.rowMeta}>
                          {product.category}
                          {product.version ? ` · версия ${product.version}` : ''} ·{' '}
                          {PRODUCT_STATUS_LABELS[product.status].toLowerCase()}
                        </span>
                      </span>
                      <span className={styles.rowCount}>
                        {formatNumber(product.cooperationCount)}{' '}
                        {pluralize(product.cooperationCount, ['связка', 'связки', 'связок'])}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className={styles.block}>
            <h3 className={styles.blockTitle}>Контакты</h3>
            {data.contacts.length === 0 ? (
              <p className={styles.empty}>Контактные лица не заведены.</p>
            ) : (
              <ul className={styles.list}>
                {data.contacts.map((contact) => (
                  <li key={contact.id} className={styles.contact}>
                    <span className={styles.rowTitle}>{contact.fullName}</span>
                    {contact.contactDetailsHidden ? (
                      <span className={styles.rowMeta}>Почта и телефон скрыты: нужны права менеджера.</span>
                    ) : (
                      <span className={styles.rowMeta}>
                        {[contact.email, contact.phone].filter(Boolean).join(' · ') || 'Почта и телефон не указаны'}
                      </span>
                    )}
                    <span className={styles.rowMeta}>
                      {contact.preferredChannels.length > 0 &&
                        `Связь: ${contact.preferredChannels.map((channel) => VENDOR_CONTACT_CHANNEL_LABELS[channel]).join(', ')} · `}
                      Основание: {CONTACT_LEGAL_BASIS_LABELS[contact.legalBasis].toLowerCase()}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className={styles.block}>
            <h3 className={styles.blockTitle}>Связки через продукты вендора</h3>
            {data.cooperations.length === 0 ? (
              <p className={styles.empty}>Продукты вендора пока ни в одной связке.</p>
            ) : (
              <ul className={styles.list}>
                {data.cooperations.map((cooperation) => (
                  <li key={cooperation.id}>
                    <Link className={styles.row} href={cooperationHref(cooperation.id)}>
                      <span className={styles.rowMain}>
                        <span className={styles.rowTitle}>
                          {cooperation.universityName} — {cooperation.programName}
                        </span>
                        <span className={styles.rowMeta}>→ {cooperation.productName}</span>
                      </span>
                      <Badge tone="neutral">{COOPERATION_STATUS_LABELS[cooperation.status]}</Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {data.courses.length > 0 && (
            <section className={styles.block}>
              <h3 className={styles.blockTitle}>Курсы ИТ-Школы на этих продуктах</h3>
              <ul className={styles.courses}>
                {data.courses.map((course) => (
                  <li key={course.id}>{course.name}</li>
                ))}
              </ul>
            </section>
          )}

          <p className={styles.updated}>Обновлено {formatDate(data.updatedAt)}</p>
        </div>
      ) : null}
    </Drawer>
  )
}
