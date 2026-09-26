'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import {
  COOPERATION_STATUSES,
  COOPERATION_STATUS_LABELS,
  type ProductListItemDto,
  type ProgramListItemDto,
  type UniversityListItemDto,
  type UserDto,
} from '@/shared/contracts'
import {
  ApiRequestError,
  Button,
  CardsSkeleton,
  EmptyState,
  ErrorState,
  Input,
  PageHeader,
  RemoteSelect,
  ResetFilters,
  ROUTES,
  Select,
  TableSkeleton,
  Toolbar,
  ToolbarItem,
  apiGetRaw,
  programWithUniversityOption,
  universityShortOption,
  useResource,
} from '@/ui'
import { leaveToLogin } from '@/ui/lib/session'
import {
  REPORT_FORMATS,
  REPORT_FORMAT_LABELS,
  hasReportFilters,
  reportCellText,
  reportFileHref,
  reportFiltersLine,
  reportGeneratedLine,
  reportPreviewPath,
  reportPrintTitle,
  reportRowsSummary,
  type ReportFilterValues,
  type ReportJsonPayload,
} from './report-table'
import styles from './report-table.module.css'

/** Больше строк одним отчётом сервер не отдаёт (`REPORT_ROW_LIMIT` — `reports.repo.ts`). */
const REPORT_ROW_LIMIT = 5000

/**
 * Превью отчёта — тот же `?format=json`, что и кнопка «Скачать JSON»: сервер отдаёт
 * его как файл (`content-disposition: attachment`), без обёртки `{ data }`, которую
 * ждёт обычный `useResource`/`apiGet` (решение 150 намеренно переиспользует один ответ
 * для файла и для экрана — см. report-table.ts). Поэтому здесь свой маленький хук
 * поверх `apiGetRaw`, а не `useResource`.
 */
function useReportPreview(path: string) {
  const [data, setData] = useState<ReportJsonPayload | null>(null)
  const [error, setError] = useState<ApiRequestError | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setData(null)
    setError(null)
    apiGetRaw<ReportJsonPayload>(path, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return
        setData(result)
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return
        const apiError =
          caught instanceof ApiRequestError ? caught : new ApiRequestError('Непредвиденная ошибка', 'INTERNAL', 0)
        if (apiError.code === 'UNAUTHORIZED') {
          void leaveToLogin()
          return
        }
        setError(apiError)
      })
    return () => controller.abort()
  }, [path, attempt])

  return {
    data,
    error,
    isLoading: data === null && error === null,
    reload: useCallback(() => setAttempt((value) => value + 1), []),
  }
}

const STATUS_OPTIONS = COOPERATION_STATUSES.map((value) => ({ value, label: COOPERATION_STATUS_LABELS[value] }))

export interface ReportTablePageProps {
  title: string
  breadcrumbLabel: string
  description: string
  /** `/api/reports/tz` или `/api/reports/catalog`. */
  endpoint: string
}

/**
 * Отчёт по ТЗ и Каталог по ТЗ — один и тот же экран для обоих (решение 150).
 *
 * Превью — тот же `json`-формат, что и файл выгрузки: то, что видно на
 * экране, и то, что выгружается, устроены одинаково и не могут разойтись
 * колонками. Скачивание — прямые ссылки на файл (браузер сохраняет его сам,
 * сессия идёт тем же cookie, как у кнопки «Выгрузить» реестра связок).
 * «Печать / PDF» печатает лист ниже — тем же приёмом, что у отчёта
 * руководителю (`/reports/portfolio`, решение 97).
 *
 * Фильтры (решение 172, ТЗ заказчика — «отчёты формируются с фильтрами по периоду,
 * вузу, ИТ-направлению, ИТ-продукту и ответственному») живут в адресе страницы:
 * ссылку на отфильтрованный отчёт можно передать коллеге, обновление страницы
 * их не теряет. `useSearchParams` требует границы `Suspense`.
 */
export function ReportTablePage(props: ReportTablePageProps) {
  return (
    <Suspense fallback={<TableSkeleton rows={8} columns={5} />}>
      <ReportTableView {...props} />
    </Suspense>
  )
}

function ReportTableView({ title, breadcrumbLabel, description, endpoint }: ReportTablePageProps) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()

  const filters: ReportFilterValues = {
    dateFrom: params.get('dateFrom') ?? '',
    dateTo: params.get('dateTo') ?? '',
    universityId: params.get('universityId') ?? '',
    programId: params.get('programId') ?? '',
    productId: params.get('productId') ?? '',
    responsibleId: params.get('responsibleId') ?? '',
    status: params.get('status') ?? '',
  }

  /** Меняет параметры фильтров в адресе, не трогая остальные (их здесь и нет). */
  function setParams(changes: Partial<Record<keyof ReportFilterValues, string | null>>) {
    const next = new URLSearchParams(params.toString())
    for (const [key, value] of Object.entries(changes)) {
      if (!value) next.delete(key)
      else next.set(key, value)
    }
    const rest = next.toString()
    router.replace(rest === '' ? pathname : `${pathname}?${rest}`, { scroll: false })
  }

  function resetFilters() {
    setParams({
      dateFrom: null,
      dateTo: null,
      universityId: null,
      programId: null,
      productId: null,
      responsibleId: null,
      status: null,
    })
  }

  const report = useReportPreview(reportPreviewPath(endpoint, filters))
  const data = report.data

  // Имена вуза/программы/продукта/ответственного для шапки печати и подписи под
  // заголовком листа — по тем же id, что и в фильтре (карточка вуза уже знает
  // имя, второй раз резолвить на сервере не нужно).
  const university = useResource<UniversityListItemDto>(
    filters.universityId ? `/api/universities/${encodeURIComponent(filters.universityId)}` : null,
  )
  const program = useResource<ProgramListItemDto>(
    filters.programId ? `/api/programs/${encodeURIComponent(filters.programId)}` : null,
  )
  const product = useResource<ProductListItemDto>(
    filters.productId ? `/api/products/${encodeURIComponent(filters.productId)}` : null,
  )
  const responsible = useResource<UserDto>(
    filters.responsibleId ? `/api/users/${encodeURIComponent(filters.responsibleId)}` : null,
  )
  const filtersLine = reportFiltersLine(filters, {
    universityName: university.data?.shortName ?? university.data?.name,
    programName: program.data?.name,
    productName: product.data?.name,
    responsibleName: responsible.data?.fullName,
    statusLabel: filters.status ? COOPERATION_STATUS_LABELS[filters.status as (typeof COOPERATION_STATUSES)[number]] : undefined,
  })

  useEffect(() => {
    if (!data) return
    const previous = document.title
    document.title = reportPrintTitle(title, data.generatedAt)
    return () => {
      document.title = previous
    }
  }, [data, title])

  const filtersActive = hasReportFilters(filters)

  return (
    <>
      <PageHeader
        title={title}
        breadcrumbs={[{ label: 'Отчёты', href: ROUTES.reports }, { label: breadcrumbLabel }]}
        description={description}
        actions={
          data ? (
            <Button variant="primary" icon="download" onClick={() => window.print()}>
              Печать / PDF
            </Button>
          ) : undefined
        }
      />

      <Toolbar
        note="Фильтры действуют и на превью ниже, и на выгрузку — CSV, XLSX и JSON скачиваются уже отфильтрованными."
        actions={filtersActive ? <ResetFilters active onReset={resetFilters} /> : undefined}
      >
        <ToolbarItem>
          <div className={styles.dates}>
            <Input
              label="С даты"
              type="date"
              title="Связки, действующие в периоде — с даты (по Москве)"
              value={filters.dateFrom}
              max={filters.dateTo || undefined}
              onChange={(event) => setParams({ dateFrom: event.target.value || null })}
            />
            <Input
              label="По дату"
              type="date"
              title="Связки, действующие в периоде — по дату включительно (по Москве)"
              value={filters.dateTo}
              min={filters.dateFrom || undefined}
              onChange={(event) => setParams({ dateTo: event.target.value || null })}
            />
          </div>
        </ToolbarItem>
        <ToolbarItem>
          <RemoteSelect<UniversityListItemDto>
            label="Вуз"
            endpoint="/api/universities"
            params={{ withRating: 'false', sort: 'name' }}
            toOption={universityShortOption}
            placeholder="Все вузы"
            value={filters.universityId}
            onValueChange={(value) =>
              // Программа принадлежит вузу: после его смены прежний выбор
              // программы дал бы заведомо пустой отчёт.
              setParams({ universityId: value || null, programId: null })
            }
          />
        </ToolbarItem>
        <ToolbarItem>
          <RemoteSelect<ProgramListItemDto>
            label="ИТ-направление"
            endpoint="/api/programs"
            params={{ universityId: filters.universityId || undefined, sort: 'name' }}
            toOption={
              filters.universityId ? (row) => ({ value: row.id, label: row.name }) : programWithUniversityOption
            }
            placeholder="Все направления"
            value={filters.programId}
            onValueChange={(value) => setParams({ programId: value || null })}
          />
        </ToolbarItem>
        <ToolbarItem>
          <RemoteSelect<ProductListItemDto>
            label="ИТ-продукт"
            endpoint="/api/products"
            params={{ sort: 'name' }}
            toOption={(row) => ({ value: row.id, label: row.name })}
            placeholder="Все продукты"
            value={filters.productId}
            onValueChange={(value) => setParams({ productId: value || null })}
          />
        </ToolbarItem>
        <ToolbarItem>
          <RemoteSelect<UserDto>
            label="Ответственный"
            endpoint="/api/users"
            toOption={(row) => ({ value: row.id, label: row.fullName })}
            searchPlaceholder="ФИО"
            placeholder="Любой ответственный"
            value={filters.responsibleId}
            onValueChange={(value) => setParams({ responsibleId: value || null })}
          />
        </ToolbarItem>
        <ToolbarItem>
          <Select
            label="Статус"
            placeholder="Любой статус"
            value={filters.status}
            onValueChange={(value) => setParams({ status: value || null })}
            options={STATUS_OPTIONS}
          />
        </ToolbarItem>
      </Toolbar>

      <div className={styles.actions}>
        {REPORT_FORMATS.map((format) => (
          <Button
            key={format}
            variant="secondary"
            icon="download"
            href={reportFileHref(endpoint, format, filters)}
            external
            title={`${title} файлом ${REPORT_FORMAT_LABELS[format]}${filtersActive ? ' с текущими фильтрами' : ''}`}
          >
            Скачать {REPORT_FORMAT_LABELS[format]}
          </Button>
        ))}
      </div>

      {report.isLoading ? (
        <CardsSkeleton count={1} />
      ) : report.error ? (
        <ErrorState error={report.error} onRetry={report.reload} />
      ) : data ? (
        <ReportSheet title={title} data={data} filtersActive={filtersActive} filtersLine={filtersLine} />
      ) : null}
    </>
  )
}

function ReportSheet({
  title,
  data,
  filtersActive,
  filtersLine,
}: {
  title: string
  data: ReportJsonPayload
  filtersActive: boolean
  filtersLine: string | null
}) {
  return (
    <article className={styles.sheet} data-print-document aria-label={title}>
      <div className={styles.head}>
        <h2 className={styles.title}>{title}</h2>
        <p className={styles.meta}>
          <span>{reportGeneratedLine(data.generatedAt)}</span>
          <span>{reportRowsSummary(data.rows.length)}</span>
          {data.rows.length >= REPORT_ROW_LIMIT && (
            <span>Показаны первые {REPORT_ROW_LIMIT} строк — предел размера отчёта.</span>
          )}
        </p>
        {/* Показывается и на экране, и на печати: получивший распечатку видит,
            что это не весь набор данных, а срез по фильтрам. */}
        {filtersLine && <p className={styles.filtersLine}>{filtersLine}</p>}
      </div>

      {data.rows.length === 0 ? (
        <EmptyState
          title="Данных пока нет"
          description={
            filtersActive
              ? 'По выбранным фильтрам ни одной связки не нашлось. Снимите часть фильтров.'
              : 'По текущим связкам строк для этого отчёта не нашлось.'
          }
        />
      ) : (
        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                {data.columns.map((column) => (
                  <th key={column} scope="col">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row, index) => (
                // Строки отчёта не несут собственного идентификатора (сервер
                // отдаёт их позиционно, как в CSV) — индекс тут устойчив: список
                // приходит целиком одним запросом и не пересортировывается на месте.
                <tr key={index}>
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex}>{reportCellText(cell)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </article>
  )
}
