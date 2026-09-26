import { assertCan, universityScope } from '@/shared/auth/permissions'
import { COOPERATION_STATUS_LABELS, TRANSFER_STATUS_LABELS } from '@/shared/contracts/labels'
import { csvDate } from '@/modules/export/export.rules'
import type { CurrentUser } from '@/shared/auth/current-user'
import * as repo from './reports.repo'
import type { ReportFilterLabels } from './reports.repo'
import type { ReportFilters } from './reports.schema'
import { CATALOG_REPORT_HEADERS, TZ_REPORT_HEADERS, type ReportPayload } from './reports.rules'

/**
 * Отчёты «по ТЗ» (п.7) и «Каталог по ТЗ» (п.8) — решение 145; фильтры по периоду,
 * вузу, ИТ-направлению, ИТ-продукту, ответственному и статусу — решение 172.
 *
 * Право — `READ`, как у самого реестра связок: отчёт — другой вид тех же данных,
 * не обходной путь к ним. Представителю вуза, как и везде, — только свой вуз
 * (`universityScope`); фильтр по чужому вузу даёт пустой отчёт, а не ошибку
 * доступа (то же правило, что у реестра связок).
 */

export interface ReportResult {
  payload: ReportPayload
  filters: ReportFilters
  labels: ReportFilterLabels
}

export async function buildTzReport(user: CurrentUser, filters: ReportFilters): Promise<ReportResult> {
  assertCan(user, 'READ')
  const scope = universityScope(user)
  const [rows, labels] = await Promise.all([
    repo.findTzRows(filters, scope),
    repo.resolveFilterLabels(filters, scope),
  ])
  return {
    filters,
    labels,
    payload: {
      columns: TZ_REPORT_HEADERS,
      rows: rows.map((row) => [
        row.university.name,
        row.program.name,
        row.product?.name ?? null,
        COOPERATION_STATUS_LABELS[row.status],
        row.responsible.fullName,
      ]),
    },
  }
}

export async function buildCatalogReport(user: CurrentUser, filters: ReportFilters): Promise<ReportResult> {
  assertCan(user, 'READ')
  const scope = universityScope(user)
  const [rows, labels] = await Promise.all([
    repo.findCatalogRows(filters, scope),
    repo.resolveFilterLabels(filters, scope),
  ])
  return {
    filters,
    labels,
    payload: {
      columns: CATALOG_REPORT_HEADERS,
      rows: rows.map((row) => [
        row.university.name,
        row.product?.vendor?.name ?? null,
        row.product?.name ?? null,
        row.contractNumber,
        csvDate(row.licenseSignedAt),
        row.licenseTermYears,
        row.transferStatus ? TRANSFER_STATUS_LABELS[row.transferStatus] : null,
        row.responsible.fullName,
        row.university.contacts.map((contact) => contact.fullName).join(', ') || null,
        row.comment,
      ]),
    },
  }
}
