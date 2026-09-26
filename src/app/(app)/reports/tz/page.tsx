'use client'

import { ReportTablePage } from '../ReportTablePage'

/**
 * Отчёт по ТЗ (решение 145, п.7 функц. требований): «Наименование вуза,
 * ИТ-направление, ИТ-продукт, Статус работы с вузом, Ответственный» —
 * дословно и в этом порядке. Данные и колонки строит сервер (`GET
 * /api/reports/tz`), экран — превью и ссылки на выгрузку (решение 150).
 */
export default function TzReportPage() {
  return (
    <ReportTablePage
      title="Отчёт по ТЗ"
      breadcrumbLabel="Отчёт по ТЗ"
      description="Вуз, ИТ-направление, ИТ-продукт, статус работы и ответственный — по каждой связке, колонки дословно из ТЗ."
      endpoint="/api/reports/tz"
    />
  )
}
