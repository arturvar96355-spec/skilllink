import { conflict, invalidTransition, validationError } from '@/shared/http/errors'
import {
  MISSING_PLACEHOLDER,
  type DocumentTemplate,
} from '@/shared/config/document-templates.config'
import type { DocumentStatus, DocumentType } from '@/shared/contracts/enums'
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

/**
 * Должность в тексте документа: «Представитель вуза: заместитель декана Ветрова И. П.».
 *
 * В карточке должность записана с заглавной, как в подписи письма; внутри фразы
 * она пишется со строчной. Аббревиатуру («ИТ-директор», «CIO») не трогаем:
 * первая буква опускается, только если за ней строчная.
 */
export function positionInText(position: string | null | undefined): string | null {
  if (typeof position !== 'string') return null
  const trimmed = position.trim()
  if (trimmed.length < 2) return trimmed || null
  const second = trimmed[1]!
  const secondIsLowercaseLetter = second !== second.toUpperCase()
  return secondIsLowercaseLetter ? trimmed[0]!.toLowerCase() + trimmed.slice(1) : trimmed
}

// ───────────────────── Что пакет документов не пересобирает ─────────────────

/** Документ связки, с которым сверяется пакет. */
export interface ExistingPackageDocument {
  title: string
  type: DocumentType
  status: DocumentStatus
  templateKey: string | null
}

/**
 * Документ, который уже закрывает шаблон.
 *
 * Сверка по ключу шаблона ловила только собранное из шаблона. Договор, заведённый
 * вручную, или новая версия собранного (у неё ключа нет) проходили мимо — и пакет
 * добавлял к связке второй договор. Поэтому совпадением считается и документ того же
 * типа: у каждого шаблона свой тип. Архивные не в счёт — их заменили, действующего
 * документа по ним нет.
 */
export function findExistingForTemplate<T extends ExistingPackageDocument>(
  template: Pick<DocumentTemplate, 'key' | 'type'>,
  documents: readonly T[],
): T | null {
  const active = documents.filter((document) => document.status !== 'ARCHIVED')
  return (
    active.find((document) => document.templateKey === template.key) ??
    active.find((document) => document.type === template.type) ??
    null
  )
}

export const SKIP_REASON_NO_PRODUCT = 'не выбран IT-продукт — выберите его в связке'

/**
 * Почему шаблон не собирается, или null, если собирается.
 *
 * `force` снимает только проверку «уже есть» — это осознанная пересборка.
 * Лицензию без продукта `force` не собирает: документа «на ______» не бывает.
 */
export function packageSkipReason(
  template: Pick<DocumentTemplate, 'key' | 'type' | 'requiresProduct'>,
  options: {
    documents: readonly ExistingPackageDocument[]
    hasProduct: boolean
    force?: boolean
  },
): string | null {
  if (template.requiresProduct && !options.hasProduct) return SKIP_REASON_NO_PRODUCT
  if (options.force) return null

  const existing = findExistingForTemplate(template, options.documents)
  if (!existing) return null
  return `уже есть: «${existing.title}», ${STATUS_TEXT[existing.status].toLowerCase()}`
}

/**
 * Подпись каких документов проверяет этап «Подписание документов» (решение 87):
 * договор и лицензия (ТЗ Артура). Пункты этапа отмечает подписанный договор;
 * подпись лицензии лишь запускает ту же проверку.
 */
export const SIGNING_DOCUMENT_TYPES: readonly DocumentType[] = ['AGREEMENT', 'LICENSE']

/** Статусы, в которых подпись ещё впереди. Отклонённый и архивный — не ждут подписи. */
const AWAITING_SIGNATURE: readonly DocumentStatus[] = ['DRAFT', 'REVIEW', 'APPROVED']

/**
 * «Документы подписаны» для этапа 6: договор подписан, и ни один другой договор
 * по связке больше не ждёт подписи.
 *
 * Лицензию этап 6 не ждёт: она передаётся на этапе 7, за контрольной точкой,
 * и обычно подписывается позже договора. Одна подписанная лицензия при договоре
 * на согласовании — тоже не «документы подписаны»: это была бы неправда.
 */
export function areSigningDocumentsSigned(
  documents: ReadonlyArray<{ type: DocumentType; status: DocumentStatus }>,
): boolean {
  const agreements = documents.filter((document) => document.type === 'AGREEMENT')
  return (
    agreements.some((document) => document.status === 'SIGNED') &&
    !agreements.some((document) => AWAITING_SIGNATURE.includes(document.status))
  )
}
