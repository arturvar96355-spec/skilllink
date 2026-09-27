'use client'

import Link from 'next/link'
import type { CalculationParametersDto, RuleStatsListDto } from '@/shared/contracts'
import {
  Badge,
  ErrorState,
  HelpHint,
  Icon,
  InfoHint,
  MeasureBars,
  MockBadge,
  ROUTES,
  formatDateTime,
  formatShare,
  useResource,
} from '@/ui'
import { Row, RowsSkeleton } from './SettingsRow'
import {
  DEFAULT_MIN_TRIALS,
  outcomesText,
  ruleInfo,
  ruleThresholds,
  usefulnessConclusion,
  usefulnessRows,
} from './task-rules-view'
import settings from './settings.module.css'
import styles from './TaskRules.module.css'

const USEFULNESS_HINT =
  'Полезность — вероятность, что задача правила пригодится: её взяли в работу и довели до дела или связка ' +
  'сдвинулась в течение 30 дней. Считается по решениям сотрудников, свежие весят больше старых (память — 30 дней). ' +
  'Пока решений мало, оценка приблизительная. Поэтому она может отличаться от доли «взяли в работу» ниже: та — ' +
  'просто счёт задач, а полезность учитывает и движение связки, и давность. Чем выше полоса, тем выше задачи ' +
  'правила стоят в «Списке задач». Отметка на шкале — порог: ниже него правило «чаще отклоняют».'

const CONFIG_HINT =
  'Пороги и включение правил задаются в конфигурации сервера и утверждаются с заказчиком вместе с методикой — ' +
  'здесь их видно, но не правят. Пометка «черновое» — рабочее значение, ещё не утверждённое.'

/**
 * «Настройки → Правила списка задач» (решение 218).
 *
 * Сверху — полосы «Полезность правил» с выводом одной фразой (решение 215);
 * ниже — строка каждого правила: что ищет, порог, сколько задач создало и что
 * с ними стало, включено ли. Меняющих кнопок нет: API правил только читает —
 * пороги и выключатели живут в конфигурации сервера (`shared/config`).
 */
export function TaskRulesSection() {
  const stats = useResource<RuleStatsListDto>('/api/recommendations/rules/stats')
  const parameters = useResource<CalculationParametersDto>('/api/settings/parameters')

  if (stats.isLoading || parameters.isLoading) return <RowsSkeleton count={5} />
  if (stats.error) return <ErrorState error={stats.error} onRetry={stats.reload} />
  if (!stats.data) return null

  const rules = stats.data.rules
  // Параметры не пришли — правила всё равно показываем, без порогов (они вторичны).
  const params = parameters.data?.groups.flatMap((group) => group.parameters) ?? []
  const lowParam = params.find((param) => param.configKey === 'RECOMMENDATION_LEARNING.lowRuleWeight')
  const lowRuleWeight = typeof lowParam?.value === 'number' ? lowParam.value : null
  const trialsParam = params.find((param) => param.configKey === 'RECOMMENDATION_LEARNING.localDataTrials')
  const minTrials = typeof trialsParam?.value === 'number' ? trialsParam.value : DEFAULT_MIN_TRIALS

  return (
    <>
      <p className={settings.muted}>
        Пять правил сами ставят задачи в «Список задач». Здесь видно, что ищет каждое, с какого порога срабатывает
        и насколько его задачи пригождаются. <HelpHint topic="task-rules" /> {stats.data.isMock && <MockBadge />}
      </p>

      <section className={settings.group} aria-labelledby="task-rules-usefulness">
        <h3 className={`${settings.groupTitle} ${styles.title}`} id="task-rules-usefulness">
          Полезность правил
          <InfoHint text={USEFULNESS_HINT} />
        </h3>
        <p className={settings.muted}>{usefulnessConclusion(rules, minTrials)}</p>
        <div className={styles.chart}>
          <MeasureBars
            label="Полезность правил списка задач, процентов"
            rows={usefulnessRows(rules, lowRuleWeight, minTrials)}
            max={100}
            markerLabel={lowRuleWeight === null ? undefined : `порог «чаще отклоняют» — ${formatShare(lowRuleWeight)}`}
            valueWidth="4rem"
            labelWidth="16rem"
          />
        </div>
      </section>

      <section className={settings.group} aria-labelledby="task-rules-list">
        <h3 className={`${settings.groupTitle} ${styles.title}`} id="task-rules-list">
          Что ищет и когда срабатывает
          <InfoHint text={CONFIG_HINT} />
        </h3>
        {parameters.error && (
          <p className={settings.muted}>Пороги не загрузились: {parameters.error.message}</p>
        )}
        {rules.map((rule) => {
          const info = ruleInfo(rule.ruleKey)
          const thresholds = ruleThresholds(rule.ruleKey, params)
          return (
            <Row
              key={rule.ruleKey}
              title={rule.ruleLabel}
              caption={
                <span className={styles.lines}>
                  <span className={styles.seeks}>{info.seeks}</span>
                  <span>
                    {thresholds.length > 0
                      ? thresholds.map((part, index) => (
                          <span key={part.text}>
                            {index > 0 ? '; ' : 'Порог: '}
                            {part.text}
                            {part.isTemporary && (
                              <>
                                {' '}
                                <Badge tone="warning">черновое</Badge>
                              </>
                            )}
                          </span>
                        ))
                      : info.noThreshold}
                  </span>
                  <span className={styles.outcomes}>{outcomesText(rule.outcomes)}.</span>
                </span>
              }
            >
              <Badge tone={rule.enabled ? 'success' : 'neutral'} withDot>
                {rule.enabled ? 'Включено' : 'Выключено'}
              </Badge>
            </Row>
          )
        })}
      </section>

      <Row
        title="Сами задачи"
        caption={`Посчитано ${formatDateTime(stats.data.computedAt)}. Открытые задачи всех правил — в «Списке задач».`}
      >
        <Link className={settings.link} href={ROUTES.recommendations}>
          Открыть «Список задач»
          <Icon name="arrowRight" size={16} />
        </Link>
      </Row>
    </>
  )
}
