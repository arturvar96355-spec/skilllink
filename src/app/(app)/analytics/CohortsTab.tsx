'use client'

import { useMemo, useState, type CSSProperties } from 'react'
import type { CohortDto, CohortsDto } from '@/shared/contracts'
import {
  Badge,
  Card,
  CardsSkeleton,
  EmptyState,
  ErrorState,
  InfoHint,
  MeasureBars,
  MockBadge,
  ScrollArea,
  Section,
  Select,
  formatNumber,
  formatShare,
  pluralize,
  useResource,
} from '@/ui'
import {
  SMALL_COHORT,
  cellAt,
  cellHeat,
  cellLabel,
  cohortLabel,
  cohortShort,
  cohortsBase,
  cohortsConclusion,
  comparisonRows,
  defaultHorizon,
  halfReachedAt,
  halfText,
  isSmall,
  ladderWidth,
  quarterColumn,
  speedConclusion,
} from './cohorts-view'
import styles from './cohorts.module.css'

const COHORTS_NOTE =
  'Когорта — связки, работа по которым началась в одном квартале (по Москве). Полоса — какая доля когорты подписала договор (завершён этап 6 «Подписание документов»; отменённое подписание не считается) к концу выбранного квартала работы; справа — «сколько из скольких» и насколько это выше или ниже остальных сравнимых когорт вместе. Отменённые связки остаются в знаменателе: иначе когорта с отменами выглядела бы успешнее. Когорты меньше 5 связок и квартал, который ещё идёт, приглушены и в сравнении не участвуют.'

const LADDER_HINT =
  'Строка — когорта, колонка — квартал работы по счёту: 1-й — квартал, в котором начали, 2-й — следующий и так далее. В клетке — доля когорты, подписавшей договор к концу этого квартала, и «сколько из скольких»; доля копится и не убывает. Чем насыщеннее цвет клетки, тем больше доля. Пунктир — квартал ещё идёт, число может вырасти. Лестница получается сама: у молодой когорты прожито меньше кварталов. «Половина подписала» — в каком квартале работы договор подписала половина когорты.'

const HALF_HINT =
  'В каком квартале работы договор подписала половина связок когорты — медиана в кварталах. «Ещё нет» — половина пока не подписала. Доля копится, поэтому половина, набранная в идущем квартале, уже не изменится.'

/**
 * Вкладка «Когорты» (решение 220): связки по кварталу начала работы — сколько
 * из каждой когорты дошли до договора и как быстро. Данные — готовый
 * `/api/analytics/cohorts` (решение 120); расчёт здесь только раскладывает ответ.
 */
export function CohortsTab() {
  const resource = useResource<CohortsDto>('/api/analytics/cohorts')
  const cohorts = useMemo(() => resource.data?.cohorts ?? [], [resource.data])
  const width = ladderWidth(cohorts)
  const auto = useMemo(() => defaultHorizon(cohorts), [cohorts])
  const [picked, setPicked] = useState<number | null>(null)
  const horizon = picked !== null && picked < width ? picked : auto
  const isMock = Boolean(resource.data?.isMock)
  const hasData = cohorts.length > 0

  const horizonOptions = Array.from({ length: width }, (_, offset) => ({
    value: String(offset),
    label: offset === 0 ? '1-й квартал работы — квартал старта' : `${offset + 1}-й квартал работы`,
  }))

  return (
    <div className={styles.stack}>
      <Section
        title="Когорты: как быстро подписывают договор"
        description={
          resource.data
            ? cohortsConclusion(cohorts, horizon)
            : 'Связки по кварталу начала работы: какая доля каждой когорты подписала договор и за сколько кварталов.'
        }
        hint={COHORTS_NOTE}
        action={isMock ? <MockBadge /> : undefined}
      >
        <Card>
          {resource.isLoading ? (
            <CardsSkeleton count={1} />
          ) : resource.error ? (
            <ErrorState error={resource.error} onRetry={resource.reload} />
          ) : !hasData ? (
            <EmptyState
              icon="cooperation"
              title="Когорт пока нет"
              description="Когорта появится, когда начнётся работа хотя бы по одной связке."
            />
          ) : (
            <div className={styles.compare}>
              <div className={styles.horizon}>
                <Select
                  label="Срок сравнения"
                  value={String(horizon)}
                  onValueChange={(value) => setPicked(Number(value))}
                  options={horizonOptions}
                />
              </div>
              <MeasureBars
                rows={comparisonRows(cohorts, horizon)}
                max={100}
                label={`Доля когорты, подписавшей договор к концу ${horizon + 1}-го квартала работы`}
                valueWidth="8.5rem"
                labelWidth="10rem"
              />
            </div>
          )}
        </Card>
      </Section>

      {hasData && (
        <Section title="Лестница когорт по кварталам" description={speedConclusion(cohorts)} hint={LADDER_HINT}>
          <Card>
            <CohortLadder cohorts={cohorts} width={width} />
            <p className={styles.base}>
              {cohortsBase(cohorts)} Считаются все связки, включая приостановленные и отменённые: отменённая до
              договора остаётся в знаменателе.
            </p>
          </Card>
        </Section>
      )}
    </div>
  )
}

/** Ступени легенды — те же насыщенности, что у клеток (`heatIntensity`: от 15 до 100). */
const LEGEND_STEPS = [0, 30, 55, 80, 100]

/** Клетка лестницы: доля и «сколько из скольких»; цвет — насыщенность доли. */
function cellStyle(heat: number): CSSProperties | undefined {
  if (heat === 0) return undefined
  return {
    background: `color-mix(in srgb, var(--accent-violet) ${heat}%, var(--surface-sunken))`,
    // На насыщенной клетке число — светлым, иначе оно тонет.
    color: heat >= 60 ? 'var(--text-inverse)' : undefined,
  }
}

function CohortLadder({ cohorts, width }: { cohorts: readonly CohortDto[]; width: number }) {
  const offsets = Array.from({ length: width }, (_, offset) => offset)

  return (
    <div className={styles.ladderWrap}>
      {/* Старые когорты прожили много кварталов: лестница шире телефона листается вбок (решение 195). */}
      <ScrollArea label="Лестница когорт: доля подписавших договор по кварталам работы">
        <table className={styles.ladder}>
          <caption className="visually-hidden">
            Доля связок каждой когорты, подписавших договор, к концу каждого квартала работы
          </caption>
          <thead>
            <tr>
              <th scope="col" className={styles.corner}>
                Когорта
              </th>
              <th scope="col" className={styles.halfHead}>
                <span className={styles.halfHeadInner}>
                  Половина подписала
                  <InfoHint text={HALF_HINT} />
                </span>
              </th>
              {offsets.map((offset) => (
                <th key={offset} scope="col" className={styles.colHead}>
                  {quarterColumn(offset)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cohorts.map((cohort) => {
              const small = isSmall(cohort)
              const half = halfReachedAt(cohort)
              return (
                <tr key={cohort.cohort} data-small={small || undefined}>
                  <th scope="row" className={styles.rowHead}>
                    <span className={styles.rowLabel}>
                      <span className={styles.labelFull}>{cohortLabel(cohort.cohort)}</span>
                      <span className={styles.labelShort} aria-hidden="true">
                        {cohortShort(cohort.cohort)}
                      </span>
                    </span>
                    <span className={styles.rowSize}>
                      из {formatNumber(cohort.size)} {pluralize(cohort.size, ['связки', 'связок', 'связок'])}
                    </span>
                    {/* На телефоне колонка «Половина подписала» уходит сюда — в строку когорты. */}
                    <span className={styles.rowHalf}>
                      половина: {half === null ? 'ещё нет' : quarterColumn(half)}
                    </span>
                    {small && (
                      <span className={styles.rowBadge}>
                        <Badge tone="neutral" title={`Меньше ${SMALL_COHORT} связок: в лучшие и худшие не выдвигается`}>
                          мало данных
                        </Badge>
                      </span>
                    )}
                  </th>
                  <td className={styles.half} data-none={half === null || undefined}>
                    {halfText(cohort)}
                  </td>
                  {offsets.map((offset) => {
                    const cell = cellAt(cohort, offset)
                    if (!cell) return <td key={offset} className={styles.future} />
                    const heat = cellHeat(cohort, cell)
                    return (
                      <td key={offset} className={styles.cellTd}>
                        <span
                          className={styles.cell}
                          data-open={!cell.complete || undefined}
                          data-small={small || undefined}
                          style={cellStyle(heat)}
                          aria-label={cellLabel(cohort, cell)}
                          role="img"
                        >
                          <span className={styles.share}>{formatShare(cell.share)}</span>
                          <span className={styles.count}>
                            {formatNumber(cell.reached)} из {formatNumber(cohort.size)}
                          </span>
                          {!cell.complete && <span className={styles.pending}>пока</span>}
                        </span>
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </ScrollArea>

      <p className={styles.legend}>
        <span className={styles.legendItem}>
          <span className={styles.legendText}>меньше</span>
          <span className={styles.legendScale} aria-hidden="true">
            {LEGEND_STEPS.map((step) => (
              <span key={step} className={styles.legendCell} style={cellStyle(step)} />
            ))}
          </span>
          <span className={styles.legendText}>больше подписали</span>
        </span>
        <span className={styles.legendItem}>
          <span className={styles.legendOpen} aria-hidden="true" />
          квартал ещё идёт — «пока»
        </span>
        <span className={styles.legendItem}>
          <span className={styles.legendSmall} aria-hidden="true" />
          меньше {SMALL_COHORT} связок — без цвета, в сравнении не участвует
        </span>
      </p>
    </div>
  )
}
