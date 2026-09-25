import {
  AUDIT_ACTION_LABELS,
  AUDIT_OBJECT_TYPE_LABELS,
  COOPERATION_STATUS_LABELS,
  DOCUMENT_STATUS_LABELS,
  RECOMMENDATION_STATUS_LABELS,
  STAGE_STATUS_LABELS,
  USER_ROLE_LABELS,
  type AuditActionCode,
  type AuditLogEntryDto,
  type AuditObjectType,
} from '@/shared/contracts'
import { formatPersonShort } from '@/ui/lib/format'
import {
  cooperationHref,
  documentHref,
  productHref,
  programHref,
  recommendationHref,
  universityHref,
} from '@/ui/lib/links'

/**
 * Запись журнала — человеческими словами: что сделано, над чем, куда перейти.
 *
 * Чистые функции без React: вкладка «Журнал действий» только рисует то,
 * что они вернули, а проверяются они тестом.
 */

export function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action as AuditActionCode] ?? action
}

export function auditObjectLabel(objectType: string): string {
  return AUDIT_OBJECT_TYPE_LABELS[objectType as AuditObjectType] ?? objectType
}

/**
 * Кто действовал. Без автора — либо вход, где человек ещё не вошёл
 * (неверный пароль, неизвестная почта), либо сама система: пересчёт этапа,
 * очистка журнала по сроку.
 */
export function auditActorLabel(entry: Pick<AuditLogEntryDto, 'action' | 'user'>): string {
  if (entry.user) return formatPersonShort(entry.user.fullName)
  return entry.action.startsWith('auth.') ? 'Без входа' : 'Система'
}

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value : null

/**
 * Куда ведёт запись, если объект открывается в интерфейсе. Пользователь,
 * выгрузка, загрузка и сам журнал своих страниц не имеют — ссылки нет.
 */
export function auditObjectHref(
  entry: Pick<AuditLogEntryDto, 'objectType' | 'objectId' | 'payload' | 'cooperationId'>,
): string | null {
  const { objectId, payload } = entry
  switch (entry.objectType) {
    case 'University':
      return universityHref(objectId)
    case 'EducationalProgram':
      return programHref(objectId)
    case 'Cooperation':
      return cooperationHref(objectId)
    case 'WorkflowStage':
      return entry.cooperationId ? cooperationHref(entry.cooperationId, objectId) : null
    case 'Task':
      return entry.cooperationId ? cooperationHref(entry.cooperationId) : null
    case 'Document':
      return documentHref(objectId)
    case 'ITProduct':
      return productHref(objectId)
    // «batch» — пересборка всех рекомендаций, одной записи за ней нет.
    case 'Recommendation':
      return objectId === 'batch' ? null : recommendationHref(objectId)
    case 'Contact': {
      const universityId = text(payload?.universityId)
      return universityId ? universityHref(universityId) : null
    }
    case 'Application': {
      const programId = text(payload?.programId)
      return programId ? programHref(programId) : null
    }
    case 'Meeting': {
      const cooperationId = text(payload?.cooperationId)
      return cooperationId ? cooperationHref(cooperationId) : null
    }
    default:
      return null
  }
}

/** Подписи статусов для «из → в» и `status`: по действию понятно, чьи это статусы. */
function transitionLabels(action: string): Record<string, string> | null {
  if (action.startsWith('stage.')) return STAGE_STATUS_LABELS
  if (action.startsWith('document.')) return DOCUMENT_STATUS_LABELS
  if (action.startsWith('cooperation.')) return COOPERATION_STATUS_LABELS
  if (action.startsWith('recommendation.')) return RECOMMENDATION_STATUS_LABELS
  if (action === 'user.role.change') return USER_ROLE_LABELS
  return null
}

/** Поля, которые чаще всего попадают в `fields`, — по-русски. Остальные как есть. */
const FIELD_LABELS: Record<string, string> = {
  name: 'название',
  shortName: 'краткое название',
  title: 'название',
  status: 'статус',
  description: 'описание',
  fullName: 'ФИО',
  position: 'должность',
  universityId: 'вуз',
  responsibleId: 'ответственный',
  deadline: 'срок',
  result: 'результат',
  comment: 'комментарий',
  blockingReason: 'причина блокировки',
  goal: 'цель',
  targetDate: 'целевая дата',
  studentCount: 'обучающиеся',
  groupCount: 'группы',
  version: 'версия',
}

/** Служебные ключи полезной нагрузки — по-русски. Незнакомый ключ показывается как есть. */
const KEY_LABELS: Record<string, string> = {
  address: 'адрес',
  created: 'создано',
  updated: 'обновлено',
  imported: 'загружено',
  skipped: 'пропущено',
  closed: 'закрыто',
  total: 'всего',
  deleted: 'удалено',
  rows: 'строк',
  unknown: 'не найдено в справочнике',
  quantity: 'количество',
  applicationCount: 'заявок всего',
  participants: 'участников',
  contacts: 'контактов',
  skills: 'навыков',
  wasPrimary: 'основной контакт',
  provider: 'провайдер',
  model: 'модель',
  source: 'источник',
  outcome: 'итог',
  kind: 'вид',
  cached: 'из кэша',
  fallbackReason: 'причина шаблона',
  dataset: 'набор',
  type: 'тип',
  version: 'версия',
  affectedCooperations: 'связок затронуто',
  reopenedStages: 'этапов переоткрыто',
  addressesStripped: 'адресов стёрто',
  noteLength: 'длина пометки',
}

const keyLabel = (key: string): string => KEY_LABELS[key] ?? key

/** Какой счётчик перебора закрыл вход (shared/auth/throttle.ts). */
const COUNTER_LABELS: Record<string, string> = {
  'account-address': 'учётная запись с этого адреса',
  address: 'все попытки с адреса',
  account: 'учётная запись со всех адресов',
}

/** Ключи, значения которых — идентификаторы: человеку они ничего не скажут. */
const isIdKey = (key: string): boolean => /(^id|Id|Ids)$/.test(key)

/** Больше этого строка подробностей не бывает: журнал — не место для полотна. */
export const AUDIT_SUMMARY_MAX = 160

/**
 * Полезная нагрузка кратко: «В работе → Завершён · этап 3», «поля: ФИО, должность».
 *
 * Персональных данных в журнале нет по правилу записи (shared/audit), и здесь
 * их неоткуда взять: показываются только служебные поля. Идентификаторы
 * пропускаются — вместо них ссылка на объект.
 */
export function auditPayloadSummary(entry: Pick<AuditLogEntryDto, 'action' | 'payload'>): string | null {
  const payload = entry.payload
  if (!payload) return null

  const parts: string[] = []
  const labels = transitionLabels(entry.action)
  const from = text(payload.from)
  const to = text(payload.to)
  if (from || to) {
    const name = (value: string | null) => (value ? (labels?.[value] ?? value) : '—')
    parts.push(`${name(from)} → ${name(to)}`)
  }

  for (const [key, value] of Object.entries(payload)) {
    if (key === 'from' || key === 'to' || isIdKey(key)) continue
    if (value === null || value === undefined) continue

    if (key === 'stageNumber' && typeof value === 'number') {
      parts.push(`этап ${value}`)
    } else if (key === 'fields' && Array.isArray(value)) {
      const names = value.filter((item): item is string => typeof item === 'string')
      if (names.length > 0) parts.push(`поля: ${names.map((field) => FIELD_LABELS[field] ?? field).join(', ')}`)
    } else if (key === 'knownAccount' && value === false) {
      parts.push('учётной записи с такой почтой нет')
    } else if (key === 'isDone' && typeof value === 'boolean') {
      parts.push(value ? 'отмечен' : 'отметка снята')
    } else if (key === 'counters' && Array.isArray(value)) {
      const names = value.map((item) => COUNTER_LABELS[String(item)] ?? String(item))
      if (names.length > 0) parts.push(`закрыт счётчиком: ${names.join(', ')}`)
    } else if (key === 'status' && typeof value === 'string') {
      parts.push(`статус: ${labels?.[value] ?? value}`)
    } else if (key === 'role' && typeof value === 'string') {
      parts.push(`роль: ${USER_ROLE_LABELS[value as keyof typeof USER_ROLE_LABELS] ?? value}`)
    } else if (Array.isArray(value)) {
      const items = value.filter((item) => typeof item === 'string' || typeof item === 'number')
      if (items.length > 0) parts.push(`${keyLabel(key)}: ${items.join(', ')}`)
    } else if (typeof value === 'boolean') {
      parts.push(`${keyLabel(key)}: ${value ? 'да' : 'нет'}`)
    } else if (typeof value === 'number') {
      parts.push(`${keyLabel(key)}: ${value}`)
    } else if (typeof value === 'string' && value.length <= 60) {
      parts.push(`${keyLabel(key)}: ${value}`)
    }
  }

  if (parts.length === 0) return null
  const summary = parts.join(' · ')
  return summary.length > AUDIT_SUMMARY_MAX ? `${summary.slice(0, AUDIT_SUMMARY_MAX - 1)}…` : summary
}

/**
 * Период фильтра — границы московских суток в ISO. Поле даты даёт «2026-09-25»,
 * а журнал пишет время в UTC: без смещения запись в 01:00 по Москве
 * попала бы во вчерашний день.
 */
export function moscowDayStart(date: string): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return undefined
  return new Date(`${date}T00:00:00.000+03:00`).toISOString()
}

export function moscowDayEnd(date: string): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return undefined
  return new Date(`${date}T23:59:59.999+03:00`).toISOString()
}
