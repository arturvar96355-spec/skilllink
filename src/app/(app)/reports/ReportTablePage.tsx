'use client'

import { useEffect } from 'react'
import {
  Button,
  CardsSkeleton,
  EmptyState,
  ErrorState,
  PageHeader,
  ROUTES,
  buildQuery,
  useResource,
} from '@/ui'
import {
  REPORT_FORMATS,
  REPORT_FORMAT_LABELS,
  reportCellText,
  reportFileHref,
  reportGeneratedLine,
  reportPrintTitle,
  reportRowsSummary,
  type ReportJsonPayload,
} from './report-table'
import styles from './report-table.module.css'

/** Больше строк одним отчётом сервер не отдаёт (`REPORT_ROW_LIMIT` — `reports.repo.ts`). */
const REPORT_ROW_LIMIT = 5000

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
 */
export function ReportTablePage({ title, breadcrumbLabel, description, endpoint }: ReportTablePageProps) {
  const report = useResource<ReportJsonPayload>(`${endpoint}${buildQuery({ format: 'json' })}`)
  const data = report.data

  useEffect(() => {
    if (!data) return
    const previous = document.title
    document.title = reportPrintTitle(title, data.generatedAt)
    return () => {
      document.title = previous
    }
  }, [data, title])

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

      <div className={styles.actions}>
        {REPORT_FORMATS.map((format) => (
          <Button
            key={format}
            variant="secondary"
            icon="download"
            href={reportFileHref(endpoint, format)}
            external
            title={`${title} файлом ${REPORT_FORMAT_LABELS[format]}`}
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
        <ReportSheet title={title} data={data} />
      ) : null}
    </>
  )
}

function ReportSheet({ title, data }: { title: string; data: ReportJsonPayload }) {
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
      </div>

      {data.rows.length === 0 ? (
        <EmptyState title="Данных пока нет" description="По текущим связкам строк для этого отчёта не нашлось." />
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
