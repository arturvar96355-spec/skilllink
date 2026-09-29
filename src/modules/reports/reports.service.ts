import { assertCan, can, universityScope } from '@/shared/auth/permissions'
import { COOPERATION_STATUS_LABELS, TRANSFER_STATUS_LABELS } from '@/shared/contracts/labels'
import { csvDate } from '@/modules/export/export.rules'
import type { CurrentUser } from '@/shared/auth/current-user'
import * as repo from './reports.repo'
import type { ReportFilterLabels } from './reports.repo'
import type { ReportFilters } from './reports.schema'
import { CATALOG_REPORT_HEADERS, TZ_REPORT_HEADERS, catalogRowsFilledFirst, type ReportPayload } from './reports.rules'

/**
 * Отчёты «по ТЗ» (п.7) и «Каталог по ТЗ» (п.8) — решение 145; фильтры по периоду,
 * вузу, ИТ-направлению, ИТ-продукту, ответственному и статусу — решение 172.
 *
 * Право — `ANALYTICS` (решение 225, находка внешнего ревью 2): раздел «Отчёты» представителю
 * вуза закрыт (навигация, справка), а в строках — внутренний комментарий сотрудников,
 * ФИО менеджера и ответственных. Раньше было `READ` + `universityScope`, и прямой
 * запрос `rep@ … /api/reports/catalog?format=json` отдавал всё это по своему вузу.
 * Состав ролей `ANALYTICS` = `READ` без `UNIVERSITY_REP`: сотрудникам — как раньше,
 * эксперту — тоже (право в списке читаемых, решение 147). `universityScope` оставлен:
 * для сотрудников он пустой, а при расширении права сузит выборку по-прежнему.
 */

export interface ReportResult {
  payload: ReportPayload
  filters: ReportFilters
  labels: ReportFilterLabels
}

export async function buildTzReport(user: CurrentUser, filters: ReportFilters): Promise<ReportResult> {
  assertCan(user, 'ANALYTICS')
  const scope = universityScope(user)
  const [rows, labels] = await Promise.all([
    repo.findTzRows(filters, scope),
    // ФИО ответственного в шапке — только тем, кому доступен справочник
    // пользователей (то же право, что у GET /api/users), иначе представитель
    // вуза получил бы ФИО по произвольному responsibleId.
    repo.resolveFilterLabels(filters, scope, can(user, 'ANALYTICS')),
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
  assertCan(user, 'ANALYTICS')
  const scope = universityScope(user)
  const [rows, labels] = await Promise.all([
    repo.findCatalogRows(filters, scope),
    repo.resolveFilterLabels(filters, scope, can(user, 'ANALYTICS')),
  ])
  return {
    filters,
    labels,
    payload: {
      columns: CATALOG_REPORT_HEADERS,
      rows: catalogRowsFilledFirst(rows.map((row) => [
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
      ])),
    },
  }
}
