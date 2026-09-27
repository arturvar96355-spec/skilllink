import type { CohortCellDto, CohortDto } from '@/shared/contracts'
import type { MeasureBarRow } from '@/ui/data/MeasureBars'
import { formatNumber, formatPeriod, formatPoints, formatShare, pluralize } from '@/ui/lib/format'
import { heatIntensity } from './heatmap-color'

/**
 * Вкладка «Когорты» аналитики (решение 220) над готовым `/api/analytics/cohorts`
 * (решение 120): связки, сгруппированные по кварталу начала работы, и какая доля
 * каждой когорты подписала договор (закрыт этап 6) к концу каждого квартала работы.
 *
 * Сервер отдаёт кварталы, а не дни, и одну веху — договор. Поэтому «как быстро»
 * здесь — квартал работы, к концу которого подписала половина когорты (медиана
 * в кварталах), а сравнение когорт — на одном сроке: «к концу N-го квартала работы».
 *
 * Правила сравнения (правила диаграмм, решение 215):
 * - когорта меньше `SMALL_COHORT` связок помечена «мало данных» и в лучшие и худшие
 *   не выдвигается: одна подписанная связка из двух — это 50 %, но ничего не значит;
 * - квартал, который ещё идёт (`complete: false`), — доля «пока»: она может вырасти,
 *   поэтому с законченными кварталами других когорт не сравнивается.
 */

/** Меньше стольких связок — «мало данных»: когорта не участвует в сравнении. */
export const SMALL_COHORT = 5

export function isSmall(cohort: Pick<CohortDto, 'size'>): boolean {
  return cohort.size < SMALL_COHORT
}

/** «2026-Q1» → «1-й квартал 2026» — как период в остальной аналитике. */
export function cohortLabel(key: string): string {
  return formatPeriod(key)
}

/** «2026-Q1» → «1-й кв. 2026» — подпись строки на узком экране. */
export function cohortShort(key: string): string {
  const match = /^(\d{4})-Q([1-4])$/.exec(key.trim())
  return match ? `${match[2]}-й кв. ${match[1]}` : key
}

/** «2026-Q1» → «1-го квартала 2026» — для фразы «Когорта 1-го квартала 2026». */
export function cohortGenitive(key: string): string {
  const match = /^(\d{4})-Q([1-4])$/.exec(key.trim())
  return match ? `${match[2]}-го квартала ${match[1]}` : key
}

/** Колонка лестницы: offset 0 — квартал старта, «1-й кв.». */
export function quarterColumn(offset: number): string {
  return `${offset + 1}-й кв.`
}

/** «к концу 2-го квартала работы» — срок сравнения словами. */
export function horizonText(offset: number): string {
  return `к концу ${offset + 1}-го квартала работы`
}

/** Сколько колонок у лестницы: самая старая когорта задаёт ширину. */
export function ladderWidth(cohorts: readonly CohortDto[]): number {
  return cohorts.reduce((max, cohort) => Math.max(max, cohort.cells.length), 0)
}

/** Клетка когорты на сроке `offset`; нет — квартал ещё не наступил. */
export function cellAt(cohort: CohortDto, offset: number): CohortCellDto | null {
  return cohort.cells.find((cell) => cell.offset === offset) ?? null
}

/**
 * Квартал работы, к концу которого договор подписала половина когорты (медиана
 * в кварталах). Доля накопительная и не убывает, поэтому половина, набранная
 * в идущем квартале, уже окончательна. null — половина пока не подписала.
 */
export function halfReachedAt(cohort: CohortDto): number | null {
  for (const cell of cohort.cells) {
    if (cell.share !== null && cell.share >= 0.5) return cell.offset
  }
  return null
}

/** «во втором», но «в первом», «в третьем»: предлог по произношению числа. */
function inPrefix(offset: number): string {
  return offset === 1 ? 'во' : 'в'
}

/** «во 2-м кв.» / «ещё нет» — ячейка колонки «Половина подписала». */
export function halfText(cohort: CohortDto): string {
  const offset = halfReachedAt(cohort)
  return offset === null ? 'ещё нет' : `${inPrefix(offset)} ${offset + 1}-м кв.`
}

/** Когорты, которые честно сравнивать на сроке: не малые и квартал закончился. */
export function comparableAt(cohorts: readonly CohortDto[], offset: number): CohortDto[] {
  return cohorts.filter((cohort) => {
    if (isSmall(cohort)) return false
    const cell = cellAt(cohort, offset)
    return cell !== null && cell.complete && cell.share !== null
  })
}

/**
 * Срок сравнения по умолчанию: самый дальний квартал работы, на котором
 * сравнимы хотя бы две когорты. Нет такого — самый дальний хотя бы с одной;
 * нет и его — квартал старта.
 */
export function defaultHorizon(cohorts: readonly CohortDto[]): number {
  const width = ladderWidth(cohorts)
  for (const need of [2, 1]) {
    for (let offset = width - 1; offset >= 0; offset -= 1) {
      if (comparableAt(cohorts, offset).length >= need) return offset
    }
  }
  return 0
}

export interface Pooled {
  reached: number
  size: number
  share: number | null
}

/** Доля по нескольким когортам сразу: все подписавшие ко всем связкам, а не среднее процентов. */
export function pooled(cohorts: readonly CohortDto[], offset: number): Pooled {
  let reached = 0
  let size = 0
  for (const cohort of cohorts) {
    const cell = cellAt(cohort, offset)
    if (!cell) continue
    reached += cell.reached
    size += cohort.size
  }
  return { reached, size, share: size > 0 ? reached / size : null }
}

/** Лучшая сравнимая когорта на сроке; при равной доле — более ранняя. */
export function bestAt(cohorts: readonly CohortDto[], offset: number): CohortDto | null {
  let best: CohortDto | null = null
  let bestShare = -1
  for (const cohort of comparableAt(cohorts, offset)) {
    const share = cellAt(cohort, offset)?.share ?? 0
    if (share > bestShare) {
      best = cohort
      bestShare = share
    }
  }
  return best
}

const cohortsWord = (count: number) => pluralize(count, ['когорте', 'когортах', 'когортах'])

/**
 * Вывод одной фразой из данных (решение 215): какая когорта быстрее дошла
 * до договора на сроке и насколько — против остальных сравнимых когорт вместе.
 */
export function cohortsConclusion(cohorts: readonly CohortDto[], offset: number): string {
  if (cohorts.length === 0) return 'Связок пока нет — когорты появятся, когда начнётся работа хотя бы по одной.'
  const horizon = horizonText(offset)
  const comparable = comparableAt(cohorts, offset)

  if (comparable.length === 0) {
    return `Сравнивать ${horizon} пока не на чем: в когортах меньше ${SMALL_COHORT} связок или квартал ещё идёт.`
  }

  if (comparable.length === 1) {
    const only = comparable[0]!
    const cell = cellAt(only, offset)!
    return `Сравнивать ${horizon} пока не с чем: закончился он только у когорты ${cohortGenitive(only.cohort)} — договор подписали ${formatShare(cell.share)} (${formatNumber(cell.reached)} из ${formatNumber(only.size)}).`
  }

  const best = bestAt(cohorts, offset)!
  const bestCell = cellAt(best, offset)!
  const others = pooled(
    comparable.filter((cohort) => cohort !== best),
    offset,
  )
  const all = pooled(comparable, offset)

  // «Вровень» — когда целые проценты совпадают: иначе фраза назвала бы лидера при «22% против 22%».
  if (bestCell.share === null || others.share === null || Math.round(bestCell.share * 100) <= Math.round(others.share * 100)) {
    return `Когорты идут вровень: ${horizon} договор подписали ${formatShare(all.share)} связок (${formatNumber(all.reached)} из ${formatNumber(all.size)}) в ${formatNumber(comparable.length)} ${cohortsWord(comparable.length)}.`
  }

  return `Когорта ${cohortGenitive(best.cohort)} быстрее всех дошла до договора: ${horizon} подписали ${formatShare(bestCell.share)} (${formatNumber(bestCell.reached)} из ${formatNumber(best.size)}) против ${formatShare(others.share)} у остальных.`
}

/**
 * Полосы сравнения на одном сроке: когорта — полоса «подписали из всех», шкала
 * 0–100 %. Рядом — отклонение словами от остальных сравнимых когорт вместе: та же
 * база, что у вывода под заголовком, поэтому «22 % против 15 % у остальных» там
 * и «на 7 пунктов выше остальных» здесь — одни и те же числа. Порядок — по времени
 * старта: так видно, ускоряется работа или нет. Малые и незаконченные — приглушены
 * и подписаны словами, отклонение у них не считается.
 */
export function comparisonRows(cohorts: readonly CohortDto[], offset: number): MeasureBarRow[] {
  const comparable = comparableAt(cohorts, offset)
  const rows: MeasureBarRow[] = []
  for (const cohort of cohorts) {
    const cell = cellAt(cohort, offset)
    if (!cell) continue
    const share = cell.share
    const base = {
      key: cohort.cohort,
      label: cohortLabel(cohort.cohort),
      value: share === null ? null : share * 100,
      valueText: `${formatShare(share)} · ${formatNumber(cell.reached)} из ${formatNumber(cohort.size)}`,
    }
    if (isSmall(cohort)) {
      rows.push({ ...base, tone: 'muted', note: `мало данных — меньше ${SMALL_COHORT} связок`, noteTone: 'muted' })
    } else if (!cell.complete) {
      rows.push({ ...base, tone: 'muted', note: 'квартал ещё идёт — это «пока»', noteTone: 'muted' })
    } else {
      const others = pooled(
        comparable.filter((item) => item !== cohort),
        offset,
      ).share
      rows.push({ ...base, note: deviationText(share, others) ?? 'сравнить пока не с чем', noteTone: others === null ? 'muted' : 'default' })
    }
  }
  return rows
}

/** Отклонение словами: «на 7 пунктов выше остальных», «на уровне остальных». */
export function deviationText(share: number | null, others: number | null): string | undefined {
  if (share === null || others === null) return undefined
  const gap = Math.round(share * 100) - Math.round(others * 100)
  if (gap === 0) return 'на уровне остальных'
  return `на ${formatPoints(Math.abs(gap))} ${gap > 0 ? 'выше' : 'ниже'} остальных`
}

/** Насыщенность клетки лестницы 0..100; малая когорта — без цвета: её доля не сигнал. */
export function cellHeat(cohort: CohortDto, cell: CohortCellDto): number {
  if (isSmall(cohort) || cell.share === null) return 0
  return heatIntensity(cell.share * 100, 100)
}

/** Подпись клетки для программ чтения с экрана — то же, что видно глазами. */
export function cellLabel(cohort: CohortDto, cell: CohortCellDto): string {
  const parts = [
    `${cohortLabel(cohort.cohort)}, ${horizonText(cell.offset)}: ${formatShare(cell.share)}, ${formatNumber(cell.reached)} из ${formatNumber(cohort.size)}`,
  ]
  if (!cell.complete) parts.push('квартал ещё идёт')
  if (isSmall(cohort)) parts.push('мало данных')
  return parts.join(', ')
}

/** База подсчёта одной строкой: сколько связок и в скольких когортах. */
export function cohortsBase(cohorts: readonly CohortDto[]): string {
  const total = cohorts.reduce((sum, cohort) => sum + cohort.size, 0)
  const small = cohorts.filter(isSmall).length
  const head = `${formatNumber(total)} ${pluralize(total, ['связка', 'связки', 'связок'])} в ${formatNumber(cohorts.length)} ${cohortsWord(cohorts.length)}`
  const tail =
    small > 0
      ? `; ${formatNumber(small)} ${pluralize(small, ['когорта', 'когорты', 'когорт'])} меньше ${SMALL_COHORT} связок — «мало данных», в сравнении не участвуют`
      : ''
  return `${head}${tail}.`
}

/** «во 2-м квартале работы». */
function inQuarterText(offset: number): string {
  return `${inPrefix(offset)} ${offset + 1}-м квартале работы`
}

/**
 * «Как быстро» одной фразой: в каком квартале работы половина когорты обычно
 * подписывает договор (самый частый квартал среди сравнимых когорт; при равенстве —
 * более ранний) и у каких когорт половина ещё не набралась. Малые когорты не считаются.
 */
export function speedConclusion(cohorts: readonly CohortDto[]): string {
  const counted = cohorts.filter((cohort) => !isSmall(cohort))
  if (counted.length === 0) {
    return cohorts.length === 0
      ? 'Когорт пока нет.'
      : `Во всех когортах меньше ${SMALL_COHORT} связок — скорость по ним не оценить.`
  }
  const byOffset = new Map<number, number>()
  const pending: CohortDto[] = []
  for (const cohort of counted) {
    const offset = halfReachedAt(cohort)
    if (offset === null) pending.push(cohort)
    else byOffset.set(offset, (byOffset.get(offset) ?? 0) + 1)
  }
  if (byOffset.size === 0) return 'Ни в одной когорте половина связок ещё не подписала договор.'

  let typical = -1
  let typicalCount = 0
  for (const [offset, count] of [...byOffset.entries()].sort(([a], [b]) => a - b)) {
    if (count > typicalCount) {
      typical = offset
      typicalCount = count
    }
  }
  const head = `Половина когорты обычно подписывает договор ${inQuarterText(typical)} — так в ${formatNumber(typicalCount)} ${cohortsWord(typicalCount)} из ${formatNumber(counted.length)}`
  if (pending.length === 0) return `${head}.`
  const tail =
    pending.length === 1
      ? `в когорте ${cohortGenitive(pending[0]!.cohort)} половина пока не подписала`
      : `ещё в ${formatNumber(pending.length)} ${cohortsWord(pending.length)} половина пока не подписала`
  return `${head}; ${tail}.`
}
