import type { CalculationParameterDto, RuleOutcomesDto, RuleStatsDto } from '@/shared/contracts'
import type { MeasureBarRow } from '@/ui/data/MeasureBars'
import { formatCount, formatNumber, formatShare } from '@/ui/lib/format'
import { formatParameterValue } from './parameter-format'

/**
 * «Настройки → Правила списка задач» (решение 218) — чистая логика без React.
 *
 * По каждому из пяти правил: что ищет (одна фраза), порог (из тех же параметров
 * расчётов, что вкладка «Параметры расчётов»), сколько задач создало и что с ними
 * стало, полезность из обучения (решение 119). Пороги и включение правил живут
 * в конфигурации сервера — API их не меняет, поэтому здесь они только показаны.
 */

/** Часть порога: какой параметр и как его прочитать фразой — «высокий приоритет с 7 дн. просрочки». */
export interface ThresholdSpec {
  /** Ключ параметра расчётов (`GET /api/settings/parameters`). */
  key: string
  /** Фраза из значения, уже подписанного по единице («7 дн.», «60 %», «4-го этапа»); null — не показывать. */
  phrase: (value: string, raw: CalculationParameterDto['value']) => string | null
}

export interface TaskRuleInfo {
  /** Что правило ищет — одной фразой, словами сотрудника. */
  seeks: string
  thresholds: readonly ThresholdSpec[]
  /** У правила нет числового порога — что тогда его запускает. */
  noThreshold?: string
}

export const TASK_RULES: Record<string, TaskRuleInfo> = {
  'stage.overdue': {
    seeks: 'Этап не закрыт, а его срок уже прошёл.',
    thresholds: [
      { key: 'RECOMMENDATION_RULES.overdueHighDays', phrase: (value) => `высокий приоритет с ${value} просрочки` },
      { key: 'RECOMMENDATION_RULES.overdueCriticalDays', phrase: (value) => `критичный с ${value}` },
    ],
  },
  'skill.critical-gap-with-product': {
    seeks: 'Рынку сильно не хватает навыка, а наш IT-продукт его закрывает.',
    thresholds: [
      { key: 'SKILL_GAP.demandThreshold', phrase: (value) => `спрос рынка не ниже ${value}` },
      { key: 'RECOMMENDATION_RULES.criticalGapLimit', phrase: (value) => `не больше ${value} задач за раз` },
    ],
  },
  'cooperation.no-product': {
    seeks: 'Связка дошла до оформления документов, а IT-продукт так и не выбран.',
    thresholds: [{ key: 'RECOMMENDATION_RULES.productRequiredFromStage', phrase: (value) => `продукт нужен с ${value}` }],
  },
  'program.missing-metrics': {
    seeks: 'У программы не заполнены заявки, обучающиеся или группы — рейтинг не посчитать.',
    thresholds: [],
    noThreshold: 'Порога нет: срабатывает, когда пусто хотя бы одно из трёх полей.',
  },
  'cooperation.stalled': {
    seeks: 'Текущий этап связки не двигается: ни смены статуса, ни отметок в чек-листе, ни правок.',
    thresholds: [
      { key: 'RECOMMENDATION_RULES.stalledDays', phrase: (value) => `без движения дольше ${value}` },
      {
        key: 'STALLED_THRESHOLD.fromData',
        phrase: (_value, raw) => (raw === true ? 'где истории этапа хватает — по тому, сколько он обычно длится' : null),
      },
    ],
  },
}

/** Правило, о котором экран ничего не знает, — показывается по данным сервера, без фразы. */
export function ruleInfo(ruleKey: string): TaskRuleInfo {
  return TASK_RULES[ruleKey] ?? { seeks: 'Описание правила не заведено.', thresholds: [] }
}

export interface ThresholdPart {
  text: string
  isTemporary: boolean
}

/** Значение параметра для фразы: этап — «4-го этапа», остальное — как в «Параметрах расчётов». */
function phraseValue(param: CalculationParameterDto): string {
  if (param.unit === 'stage' && typeof param.value === 'number') return `${formatNumber(param.value)}-го этапа`
  return formatParameterValue(param)
}

/** Порог правила фразами из параметров расчётов. Параметра нет в ответе — часть пропускается. */
export function ruleThresholds(ruleKey: string, parameters: readonly CalculationParameterDto[]): ThresholdPart[] {
  const parts: ThresholdPart[] = []
  for (const spec of ruleInfo(ruleKey).thresholds) {
    const param = parameters.find((item) => item.configKey === spec.key)
    if (!param) continue
    const text = spec.phrase(phraseValue(param), param.value)
    if (text) parts.push({ text, isTemporary: param.isTemporary })
  }
  return parts
}

/** Доля целым процентом от всего; из нуля — ноль, а не деление на ноль. */
function share(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0
}

/**
 * «Создало 15 задач: взяли в работу 6 (40 %), отклонили 5 (33 %), ждут решения 4».
 * Та же база, что у «Списка задач», — сами задачи по статусам.
 */
export function outcomesText(outcomes: RuleOutcomesDto): string {
  if (outcomes.total === 0) return 'Задач ещё не создавало'
  const created = `Создало ${formatCount(outcomes.total, ['задачу', 'задачи', 'задач'])}`
  return (
    `${created}: взяли в работу ${formatNumber(outcomes.taken)} (${share(outcomes.taken, outcomes.total)}%), ` +
    `отклонили ${formatNumber(outcomes.dismissed)} (${share(outcomes.dismissed, outcomes.total)}%), ` +
    `ждут решения ${formatNumber(outcomes.open)}`
  )
}

/** Оценка опирается на свои решения по правилу, а не на общий уровень. */
function hasOwnData(rule: Pick<RuleStatsDto, 'pSource'>): boolean {
  return rule.pSource === 'local'
}

/**
 * Полосы «Полезность правил» (решение 215, `MeasureBars`): длина — вероятность, что
 * задача правила окажется полезной, в процентах; отметка — порог «чаще отклоняют».
 * Ниже порога — жёлтая (ниже цели); число подписано всегда; рядом — интервал
 * или честное «мало данных».
 */
export function usefulnessRows(rules: readonly RuleStatsDto[], lowRuleWeight: number | null): MeasureBarRow[] {
  return rules.map((rule) => {
    const percent = Math.round(rule.p * 100)
    const below = lowRuleWeight !== null && rule.p < lowRuleWeight
    const [low, high] = rule.ci90
    return {
      key: rule.ruleKey,
      label: rule.ruleLabel,
      value: percent,
      valueText: formatShare(rule.p),
      marker: lowRuleWeight === null ? null : Math.round(lowRuleWeight * 100),
      tone: below ? 'warning' : 'default',
      note: hasOwnData(rule)
        ? `${below ? 'чаще отклоняют; ' : ''}скорее всего ${Math.round(low * 100)}–${formatShare(high)}`
        : 'мало решений — оценка по общему уровню',
      noteTone: below ? 'warning' : 'muted',
    }
  })
}

/** Вывод одной фразой под заголовком диаграммы (решение 215) — из самих данных. */
export function usefulnessConclusion(rules: readonly RuleStatsDto[]): string {
  const measured = rules.filter(hasOwnData)
  if (measured.length === 0) {
    return 'Решений по задачам пока мало — полезность правил видна только по общему уровню.'
  }
  const sorted = [...measured].sort((a, b) => b.p - a.p)
  const best = sorted[0]!
  const worst = sorted[sorted.length - 1]!
  if (best.ruleKey === worst.ruleKey) {
    return `Своих решений хватает только у правила «${best.ruleLabel}»: полезны ${formatShare(best.p)} его задач.`
  }
  return (
    `Полезнее всего задачи правила «${best.ruleLabel}» (${formatShare(best.p)}), ` +
    `реже всего пригождаются — «${worst.ruleLabel}» (${formatShare(worst.p)}).`
  )
}
