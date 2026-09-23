import { PROGRAM_METRIC_LABELS, STAGE_STATUS_LABELS, type StageStatus } from '@/shared/contracts'
import { formatCount, formatDate, formatNumber } from './format'

/**
 * Данные, на которых построена рекомендация, — человеческим языком.
 *
 * Сервер отдаёт их как есть: ключи на английском, даты в UTC, статусы кодами.
 * В панели подробностей это читалось как отладочный вывод — «deadline:
 * 2026-07-28T14:32:54.827Z» вместо «Нормативный срок: 28.07.2026». Здесь каждый
 * известный ключ получает подпись и формат; служебные идентификаторы не
 * показываются — по ним вывод не проверить; незнакомый ключ и значение
 * неожиданного вида выводятся как есть, чтобы новое поле правила не пропало молча.
 */

export interface RelatedFact {
  label: string
  value: string
}

type Describe = (value: unknown, data: Record<string, unknown>) => string | null

const DAY_FORMS: [string, string, string] = ['день', 'дня', 'дней']

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function days(value: unknown): string | null {
  const count = asNumber(value)
  return count === null ? null : formatCount(count, DAY_FORMS)
}

function date(value: unknown): string | null {
  return typeof value === 'string' ? formatDate(value) : null
}

function stageStatus(value: unknown): string | null {
  if (typeof value !== 'string') return null
  return STAGE_STATUS_LABELS[value as StageStatus] ?? value
}

function names(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => {
      if (typeof item === 'string') return item
      if (item && typeof item === 'object' && 'name' in item && typeof item.name === 'string') {
        const university = 'universityName' in item ? item.universityName : null
        return typeof university === 'string' ? `${item.name} (${university})` : item.name
      }
      return null
    })
    .filter((name): name is string => name !== null)
}

const KNOWN: Record<string, { label: string; describe: Describe }> = {
  stageNumber: { label: 'Этап', describe: (value) => (asNumber(value) === null ? null : String(value)) },
  currentStageNumber: {
    label: 'Текущий этап',
    describe: (value) => (asNumber(value) === null ? null : String(value)),
  },
  status: { label: 'Статус этапа', describe: stageStatus },
  stageStatus: { label: 'Статус этапа', describe: stageStatus },
  deadline: { label: 'Нормативный срок', describe: date },
  daysOverdue: { label: 'Просрочка', describe: days },
  idleDays: { label: 'Без движения', describe: days },
  lastActivityAt: { label: 'Последнее действие', describe: date },
  demandNormalized: {
    label: 'Спрос на навык',
    describe: (value) => {
      const share = asNumber(value)
      return share === null ? null : `${Math.round(share * 100)} из 100`
    },
  },
  products: {
    label: 'Продукты с этим навыком',
    describe: (value) => names(value).join(', ') || null,
  },
  programCount: { label: 'Программ без навыка', describe: (value) => formatNumber(asNumber(value)) },
  programs: {
    label: 'Программы',
    describe: (value, data) => {
      const list = names(value)
      if (list.length === 0) return null
      const total = asNumber(data.programCount) ?? list.length
      const more = total > list.length ? ` и ещё ${total - list.length}` : ''
      return list.join('; ') + more
    },
  },
  missing: {
    label: 'Не заполнено',
    describe: (value) => {
      if (!Array.isArray(value)) return null
      return value
        .map((key) => PROGRAM_METRIC_LABELS[key as keyof typeof PROGRAM_METRIC_LABELS]?.toLowerCase() ?? String(key))
        .join(', ')
    },
  },
}

/** Служебные ссылки на записи: в тексте для человека они ничего не объясняют. */
function isIdentifier(key: string): boolean {
  return key === 'id' || key.endsWith('Id')
}

/**
 * Порядок строк задаёт этот файл, а не данные: jsonb в PostgreSQL хранит ключи
 * отсортированными по длине, и «Этап» уезжал в конец списка, под «Просрочку».
 */
const ORDER = Object.keys(KNOWN)

function byMeaning(left: string, right: string): number {
  const rank = (key: string) => (ORDER.includes(key) ? ORDER.indexOf(key) : ORDER.length)
  return rank(left) - rank(right)
}

export function describeRelatedData(data: Record<string, unknown> | null): RelatedFact[] {
  if (!data) return []
  const facts: RelatedFact[] = []
  for (const key of Object.keys(data).sort(byMeaning)) {
    const value = data[key]
    if (isIdentifier(key) || value === null || value === undefined) continue
    const known = KNOWN[key]
    // Значение не того вида, что ждали, показывается как есть, а не пропадает.
    const text = known?.describe(value, data)
    facts.push({ label: known?.label ?? key, value: text || raw(value) })
  }
  return facts
}

function raw(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value) && value.length === 0) return 'нет'
  return JSON.stringify(value)
}
