import { conflict, invalidTransition, validationError } from '@/shared/http/errors'
import { MISSING_PLACEHOLDER } from '@/shared/config/document-templates.config'
import type { DocumentStatus } from '@/shared/contracts/enums'
import { DOCUMENT_STATUS_LABELS as STATUS_TEXT } from '@/shared/contracts/labels'

/**
 * Жизненный цикл документа (раздел 9.1 ТЗ).
 *
 * Подписанный документ не редактируется и не возвращается в работу: правка подписанного
 * документа — это новая версия, а не изменение старой. Иначе теряется смысл подписи.
 */
export const ALLOWED_DOCUMENT_TRANSITIONS: Record<DocumentStatus, readonly DocumentStatus[]> = {
  DRAFT: ['REVIEW', 'ARCHIVED'],
  REVIEW: ['APPROVED', 'REJECTED', 'DRAFT', 'ARCHIVED'],
  APPROVED: ['SIGNED', 'REVIEW', 'ARCHIVED'],
  SIGNED: ['ARCHIVED'],
  REJECTED: ['DRAFT', 'ARCHIVED'],
  ARCHIVED: [],
}

/** Реэкспорт: словарь один на всю систему и живёт в контрактах, доступных фронту. */
export { DOCUMENT_STATUS_LABELS } from '@/shared/contracts/labels'

function isFilled(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

export interface DocumentState {
  status: DocumentStatus
  fileReference: string | null
  /** Текст, собранный из шаблона. Он тоже является содержимым документа. */
  content?: string | null
}

export interface DocumentTransitionRequest {
  toStatus: DocumentStatus
  comment?: string | null
}

export function assertDocumentTransition(
  document: DocumentState,
  request: DocumentTransitionRequest,
): void {
  const from = document.status
  const to = request.toStatus

  if (from === to) {
    throw invalidTransition(`Документ уже в статусе «${STATUS_TEXT[to]}»`, { from, to })
  }

  if (!ALLOWED_DOCUMENT_TRANSITIONS[from].includes(to)) {
    throw invalidTransition(
      `Недопустимый переход документа: «${STATUS_TEXT[from]}» → «${STATUS_TEXT[to]}»`,
      { from, to, allowed: ALLOWED_DOCUMENT_TRANSITIONS[from] },
    )
  }

  // Отклонение и возврат на доработку требуют основания: без него автор не поймёт, что править.
  if ((to === 'REJECTED' || (from === 'REVIEW' && to === 'DRAFT')) && !isFilled(request.comment)) {
    throw validationError('Нужен комментарий с основанием', [
      { field: 'comment', message: 'Укажите, что нужно исправить' },
    ])
  }

  // Согласовывать, утверждать и подписывать нечего, пока нет самого документа.
  assertDocumentHasContent({ ...document, status: to })
}

/** Статусы, в которых документ уже согласуют, утвердили или подписали. */
const STATUSES_WITH_CONTENT: readonly DocumentStatus[] = ['REVIEW', 'APPROVED', 'SIGNED']

/**
 * У документа дальше черновика есть содержимое: ссылка на файл или текст из шаблона.
 *
 * Проверялось только при отправке на согласование. Правка ссылки этим правилам
 * не подчинялась: у утверждённого документа без текста её можно было стереть
 * и затем подписать — в системе появлялся подписанный документ, которого нет.
 * Теперь то же правило проверяет итог любой записи — и перехода, и правки.
 */
export function assertDocumentHasContent(document: DocumentState): void {
  if (!STATUSES_WITH_CONTENT.includes(document.status)) return
  if (isFilled(document.fileReference) || isFilled(document.content)) return
  throw validationError(
    document.status === 'REVIEW'
      ? 'Нельзя отправить на согласование пустой документ'
      : `У документа в статусе «${STATUS_TEXT[document.status]}» должно быть содержимое`,
    [{ field: 'fileReference', message: 'Добавьте ссылку на документ или соберите его из шаблона' }],
  )
}

/** Подписанный документ правкам не подлежит — только новая версия. */
export function assertDocumentEditable(status: DocumentStatus): void {
  if (status === 'SIGNED' || status === 'ARCHIVED') {
    throw conflict(
      `Документ в статусе «${STATUS_TEXT[status]}» не редактируется. Создайте новую версию.`,
      { status },
    )
  }
}

/** Документ обязан быть к чему-то привязан, иначе его невозможно найти (раздел 9.1 ТЗ). */
export function assertHasLink(links: {
  cooperationId?: string | null
  universityId?: string | null
  programId?: string | null
}): void {
  if (!links.cooperationId && !links.universityId && !links.programId) {
    throw validationError('Документ должен быть привязан к связке, вузу или программе', [
      { field: 'cooperationId', message: 'Укажите хотя бы одну привязку' },
    ])
  }
}

/**
 * Следующий номер версии.
 * Версии числовые и растут на единицу: «1» → «2». Нечисловая версия наращивается суффиксом,
 * чтобы не потерять исходное обозначение вуза (например, «Приложение А» → «Приложение А.2»).
 */
export function nextVersion(current: string): string {
  const asNumber = Number(current)
  if (Number.isInteger(asNumber) && asNumber > 0) return String(asNumber + 1)

  const match = current.match(/^(.*)\.(\d+)$/)
  if (match && match[1] && match[2]) return `${match[1]}.${Number(match[2]) + 1}`

  return `${current}.2`
}

// ─────────────────────── Сборка документов из шаблонов ──────────────────────

/** Значения реквизитов для подстановки. null означает «данных нет». */
export type TemplateContext = Record<string, string | null | undefined>

export interface RenderedTemplate {
  text: string
  /**
   * Реквизиты, которых не хватило. Документ всё равно собирается, но с прочерками:
   * менеджер видит, что дописать, вместо документа с незаметными пустотами.
   */
  missing: string[]
}

const PLACEHOLDER_PATTERN = /\{\{\s*([a-zA-Z.]+)\s*\}\}/g

/**
 * Подставляет реквизиты в шаблон.
 *
 * Отсутствующее значение заменяется видимым прочерком, а не пустой строкой:
 * документ с невидимой дырой хуже документа с явным пропуском — первый подпишут
 * не глядя, второй заставит заполнить.
 */
export function renderTemplate(template: string, context: TemplateContext): RenderedTemplate {
  const missing = new Set<string>()

  const text = template.replace(PLACEHOLDER_PATTERN, (_match, rawKey: string) => {
    const key = rawKey.trim()
    const value = context[key]

    if (typeof value !== 'string' || value.trim() === '') {
      missing.add(key)
      return MISSING_PLACEHOLDER
    }
    return value
  })

  return { text, missing: [...missing].sort() }
}
