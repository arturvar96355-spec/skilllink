import type { RecommendationDto, RecommendationPriority, RecommendationTargetDto } from '@/shared/contracts'
import { formatNumber, pluralize } from '@/ui/lib/format'

/**
 * «Приоритетные действия» — очередь (решение 206, вариант A владельца).
 *
 * Строка — короткий заголовок с глаголом и «почему» одной строкой. Раньше
 * заголовком шёл полный текст правила в две строки («Дефицит навыка
 * «Kubernetes» закрывается нашим продуктом»), а объяснение — ещё в две.
 * Короткие формы собираются из полей, которые уже есть в `RecommendationDto`
 * (`relatedData`, `target`); у неизвестного правила — исходные `title` и
 * `justification`, ничего не выдумывается.
 *
 * Без React — проверяется тестом.
 */

export interface ActionSummary {
  /** Короткий заголовок с глаголом: «Предложить Kubernetes вузам». */
  title: string
  /** Почему — одной строкой из данных правила: «Спрос 85 из 100, нет в 75 программах». */
  why: string
}

type ActionSource = Pick<RecommendationDto, 'ruleKey' | 'title' | 'justification' | 'relatedData' | 'target'>

function num(data: Record<string, unknown> | null, key: string): number | null {
  const value = data?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function list(data: Record<string, unknown> | null, key: string): unknown[] | null {
  const value = data?.[key]
  return Array.isArray(value) ? value : null
}

export function summarizeAction(rec: ActionSource): ActionSummary {
  const data = rec.relatedData
  const label = rec.target.label
  const fallback = { title: rec.title, why: rec.justification }

  switch (rec.ruleKey) {
    case 'skill.critical-gap-with-product': {
      // Подпись объекта — «Навык «Kubernetes»»: в заголовок идёт само имя навыка.
      const skill = /«(.+)»/u.exec(label)?.[1] ?? /«(.+?)»/u.exec(rec.title)?.[1] ?? label
      const demand = num(data, 'demandNormalized')
      const programs = num(data, 'programCount')
      if (demand === null || programs === null) return { ...fallback, title: `Предложить ${skill} вузам` }
      return {
        title: `Предложить ${skill} вузам`,
        why: `Спрос ${formatNumber(Math.round(demand * 100))} из 100, нет в ${formatNumber(programs)} ${pluralize(programs, ['программе', 'программах', 'программах'])}`,
      }
    }
    case 'cooperation.no-product': {
      const stage = num(data, 'currentStageNumber')
      return {
        title: `Выбрать продукт: ${label}`,
        why: stage === null ? rec.justification : `Этап ${stage} из 14, продукт не выбран`,
      }
    }
    case 'cooperation.stalled': {
      const idle = num(data, 'idleDays')
      const threshold = num(data, 'thresholdDays')
      const stage = num(data, 'stageNumber')
      if (idle === null) return { ...fallback, title: `Возобновить работу: ${label}` }
      const parts = [`Без движения ${formatNumber(idle)} дн.${threshold === null ? '' : ` при пороге ${formatNumber(threshold)}`}`]
      if (stage !== null) parts.push(`этап ${stage}`)
      return { title: `Возобновить работу: ${label}`, why: parts.join(', ') }
    }
    case 'program.missing-metrics': {
      const missing = list(data, 'missing')
      // Подпись программы — «Сети и системы связи · СФУ»; в строке очереди вуз идёт
      // первым, как в соседнем блоке: «СФУ — Сети и системы связи».
      const [program, university] = label.split(' · ')
      return {
        title: `Запросить показатели: ${university && program ? `${university} — ${program}` : label}`,
        why:
          missing === null
            ? rec.justification
            : `Не заполнено ${missing.length} из 3 показателей набора`,
      }
    }
    default:
      return fallback
  }
}

/** Куда ведёт действие «Открыть …» у записи в работе — по виду объекта. */
export function openLabelOf(target: RecommendationTargetDto): string {
  switch (target.objectType) {
    case 'Cooperation':
      return 'Открыть связку'
    case 'Skill':
      return 'Открыть навык'
    case 'EducationalProgram':
      return 'Открыть программу'
    case 'University':
      return 'Открыть вуз'
  }
}

export interface ActionGroup {
  key: 'NEW' | 'IN_PROGRESS'
  label: string
  items: RecommendationDto[]
}

/**
 * «Новые» и «В работе». Порядок внутри группы — как пришёл с сервера
 * (приоритет, затем балл). Пустая группа не рисуется.
 */
export function groupActions(actions: RecommendationDto[]): ActionGroup[] {
  const groups: ActionGroup[] = [
    { key: 'NEW', label: 'Новые', items: actions.filter((item) => item.status === 'NEW') },
    { key: 'IN_PROGRESS', label: 'В работе', items: actions.filter((item) => item.status === 'IN_PROGRESS') },
  ]
  return groups.filter((group) => group.items.length > 0)
}

const PRIORITY_GENITIVE: Record<RecommendationPriority, string> = {
  CRITICAL: 'критичного',
  HIGH: 'высокого',
  MEDIUM: 'среднего',
  LOW: 'низкого',
}

/**
 * Описание блока: «5 дел высокого приоритета: новых 3, в работе 2». Приоритет
 * назван один раз, если он у всех одинаковый: пять одинаковых бирок «Высокий»
 * ничего не различали.
 */
export function actionsSummary(actions: RecommendationDto[]): string {
  if (actions.length === 0) return 'Открытые рекомендации с наибольшим приоритетом.'
  const first = actions[0]!.priority
  const same = actions.every((item) => item.priority === first)
  const head = `${formatNumber(actions.length)} ${pluralize(actions.length, ['дело', 'дела', 'дел'])}${same ? ` ${PRIORITY_GENITIVE[first]} приоритета` : ''}`
  const fresh = actions.filter((item) => item.status === 'NEW').length
  const inWork = actions.length - fresh
  const parts: string[] = []
  if (fresh > 0) parts.push(`новых ${formatNumber(fresh)}`)
  if (inWork > 0) parts.push(`в работе ${formatNumber(inWork)}`)
  return `${head}: ${parts.join(', ')}.`
}

/**
 * Какая строка раскрыта. Пока пользователь ничего не выбирал (`choice === undefined`),
 * раскрыта первая — доказательство видно сразу, на показе не нужно щёлкать
 * (из варианта B). Выбор пользователя — `id` или `null` («всё свёрнуто») — главнее.
 * Если выбранной строки больше нет (её приняли или отклонили), ничего не раскрыто.
 */
export function expandedActionId(
  actions: ReadonlyArray<{ id: string }>,
  choice: string | null | undefined,
): string | null {
  if (choice === undefined) return actions[0]?.id ?? null
  if (choice === null) return null
  return actions.some((item) => item.id === choice) ? choice : null
}
