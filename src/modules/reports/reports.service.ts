import { assertCan, universityScope } from '@/shared/auth/permissions'
import { COOPERATION_STATUS_LABELS, TRANSFER_STATUS_LABELS } from '@/shared/contracts/labels'
import { csvDate } from '@/modules/export/export.rules'
import type { CurrentUser } from '@/shared/auth/current-user'
import * as repo from './reports.repo'
import { CATALOG_REPORT_HEADERS, TZ_REPORT_HEADERS, type ReportPayload } from './reports.rules'

/**
 * Отчёты «по ТЗ» (п.7) и «Каталог по ТЗ» (п.8) — решение 145.
 *
 * Право — `READ`, как у самого реестра связок: отчёт — другой вид тех же данных,
 * не обходной путь к ним. Представителю вуза, как и везде, — только свой вуз
 * (`universityScope`).
 */

export async function buildTzReport(user: CurrentUser): Promise<ReportPayload> {
  assertCan(user, 'READ')
  const rows = await repo.findTzRows(universityScope(user))
  return {
    columns: TZ_REPORT_HEADERS,
    rows: rows.map((row) => [
      row.university.name,
      row.program.name,
      row.product?.name ?? null,
      COOPERATION_STATUS_LABELS[row.status],
      row.responsible.fullName,
    ]),
  }
}

export async function buildCatalogReport(user: CurrentUser): Promise<ReportPayload> {
  assertCan(user, 'READ')
  const rows = await repo.findCatalogRows(universityScope(user))
  return {
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
  }
}
