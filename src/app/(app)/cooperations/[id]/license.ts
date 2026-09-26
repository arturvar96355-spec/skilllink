import { dateInputToIso, formatCount, isoToDateInput, NO_DATA } from '@/ui/lib/format'

/**
 * «Лицензия и передача ПО» — блок карточки связки с полями каталога по ТЗ
 * (решение 145 добавило поля в схему и API, решение 150 — экран).
 *
 * Отдельно от компонента и без React: поля из формы в тело PATCH и текст
 * срока лицензии одинаковы и на экране, и в тесте — здесь и проверяются.
 */

/** Значения полей формы — как их отдают поля ввода, все строки. */
export interface LicenseFormValues {
  contractNumber: string
  /** Значение `<input type="date">`: `''`, если не выбрано. */
  licenseSignedAt: string
  /** Значение числового поля строкой: `''` — не заполнено. */
  licenseTermYears: string
  /** Значение `<select>`: `''` — статус не выбран. */
  transferStatus: string
  comment: string
}

/** Начальные значения формы — из карточки связки, для повторного открытия формы. */
export function licenseFormValues(data: {
  contractNumber: string | null
  licenseSignedAt: string | null
  licenseTermYears: number | null
  transferStatus: string | null
  comment: string | null
}): LicenseFormValues {
  return {
    contractNumber: data.contractNumber ?? '',
    licenseSignedAt: isoToDateInput(data.licenseSignedAt),
    licenseTermYears: data.licenseTermYears === null ? '' : String(data.licenseTermYears),
    transferStatus: data.transferStatus ?? '',
    comment: data.comment ?? '',
  }
}

/**
 * Тело `PATCH /api/cooperations/:id` — только пять полей каталога.
 * Пустое поле — `null` (стереть значение), как и у остальных необязательных
 * полей связки (решение по образцу `CreateCooperationModal`).
 */
export function buildLicensePatch(form: LicenseFormValues): Record<string, unknown> {
  const contractNumber = form.contractNumber.trim()
  const comment = form.comment.trim()
  const years = form.licenseTermYears.trim()
  return {
    contractNumber: contractNumber === '' ? null : contractNumber,
    licenseSignedAt: dateInputToIso(form.licenseSignedAt),
    licenseTermYears: years === '' ? null : Number(years),
    transferStatus: form.transferStatus === '' ? null : form.transferStatus,
    comment: comment === '' ? null : comment,
  }
}

/** Срок действия лицензии словами: «3 года»; не заполнен — «Нет данных», а не «0». */
export function licenseTermYearsText(years: number | null): string {
  if (years === null) return NO_DATA
  return formatCount(years, ['год', 'года', 'лет'])
}
