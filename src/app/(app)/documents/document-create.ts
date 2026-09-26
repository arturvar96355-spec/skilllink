import type { DocumentType } from '@/shared/contracts'
import { dateInputToIso } from '@/ui/lib/format'

/**
 * Добавление документа вручную (задача «Данные без экрана», пункт 3).
 *
 * Тело `POST /api/documents` собирается отдельно от компонента: то же правило,
 * что у `buildLicensePatch` в карточке связки — пустое поле формы превращается
 * в `null` (стереть/не указано), а не пропускается и не отправляется пустой строкой.
 */
export interface DocumentFormValues {
  type: DocumentType
  title: string
  /** Пустая строка — версия не указана, сервер поставит значение по умолчанию «1». */
  version: string
  fileReference: string
  responsibleId: string
  /** Значение `<input type="date">`. */
  issuedAt: string
}

/** Привязка документа: пустая строка поля — «не выбрано» (`null`). */
export interface DocumentLinkValues {
  cooperationId: string
  universityId: string
  programId: string
}

/** `''` в форме привязки → `null` в теле запроса. */
function orNull(value: string): string | null {
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

export function buildCreateDocumentInput(
  form: DocumentFormValues,
  links: DocumentLinkValues,
): Record<string, unknown> {
  const version = form.version.trim()
  return {
    type: form.type,
    title: form.title.trim(),
    // Пустая версия не отправляется вовсе: у поля есть значение по умолчанию на сервере.
    ...(version === '' ? {} : { version }),
    fileReference: orNull(form.fileReference),
    responsibleId: orNull(form.responsibleId),
    issuedAt: dateInputToIso(form.issuedAt),
    cooperationId: orNull(links.cooperationId),
    universityId: orNull(links.universityId),
    programId: orNull(links.programId),
  }
}
