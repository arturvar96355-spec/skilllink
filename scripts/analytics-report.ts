/**
 * Цифры для слайда: длительность этапов по Каплану–Мейеру и «Система заметила»
 * (решение 120, docs/ANALYTICS_MODEL.md).
 *
 *   npm run analytics:report
 *
 * Только чтение базы из DATABASE_URL (.env). Печатает таблицу этапов — наблюдения,
 * переходы, цензура, медиана и p90 с 95% интервалом, порог застоя и откуда он, —
 * воронку по вехам и список инсайтов. Считает теми же функциями, что API.
 */
import 'dotenv/config'
import { prisma } from '@/shared/db/prisma'
import type { CurrentUser } from '@/shared/auth/current-user'
import { STALLED_THRESHOLD } from '@/shared/config/analytics.config'
import { cohorts, funnel, insights, stageDurations } from '@/modules/analytics/stage-analytics.service'

/** Отчёт читает всё, как аналитик: право ANALYTICS, без области вуза. */
const REPORT_USER: CurrentUser = {
  id: 'analytics-report',
  email: 'analytics-report@skilllink.invalid',
  fullName: 'Отчёт аналитики',
  role: 'ANALYST',
  universityId: null,
}

const pad = (value: string, width: number) => (value.length >= width ? value : value + ' '.repeat(width - value.length))
const left = (value: string, width: number) => (value.length >= width ? value : ' '.repeat(width - value.length) + value)
const day = (value: number | null) => (value === null ? '—' : String(value))
const interval = (ci: { low: number | null; high: number | null }) => `[${day(ci.low)}; ${ci.high === null ? '>' : ci.high}]`
const percent = (value: number | null) => (value === null ? '—' : `${Math.round(value * 100)}%`)

async function main(): Promise<number> {
  if (!process.env.DATABASE_URL) {
    console.error('Не задан DATABASE_URL')
    return 1
  }
  const now = new Date()
  const durations = await stageDurations(REPORT_USER, now)

  console.log(`Длительность этапов по Каплану–Мейеру — ${now.toISOString().slice(0, 10)}`)
  console.log(
    `Оценке верим при ≥ ${durations.minObservations} связках и ≥ ${durations.minEvents} переходах; ` +
      `порог застоя — p${Math.round(durations.quantile * 100)}, флаг «по данным»: ${durations.fromData ? 'вкл' : 'выкл'}.` +
      (durations.isMock ? ' Данные демонстрационные.' : ''),
  )
  console.log('')
  console.log(
    [
      left('№', 2),
      pad('Этап', 44),
      left('n', 4),
      left('пер.', 5),
      left('цен.', 5),
      left('медиана', 8),
      pad(' 95% ДИ', 11),
      left('p90', 5),
      pad(' 95% ДИ', 11),
      pad(' порог застоя', 22),
    ].join(' '),
  )
  for (const stage of durations.stages) {
    const title = stage.title.length > 44 ? `${stage.title.slice(0, 43)}…` : stage.title
    const threshold =
      stage.threshold.source === 'km'
        ? `${stage.threshold.days} дн. (по данным)`
        : `${stage.threshold.days} дн. (ручной)`
    console.log(
      [
        left(String(stage.stageNumber), 2),
        pad(title, 44),
        left(String(stage.n), 4),
        left(String(stage.events), 5),
        left(String(stage.censored), 5),
        left(day(stage.median), 8),
        pad(` ${interval(stage.ci.median)}`, 11),
        left(day(stage.p90), 5),
        pad(` ${interval(stage.ci.p90)}`, 11),
        pad(` ${threshold}`, 22),
        stage.status === 'ok' ? '' : ' мало данных',
      ].join(' '),
    )
  }
  const best = [...durations.stages].sort((a, b) => b.events - a.events)[0]
  if (best && durations.stages.every((stage) => stage.status !== 'ok')) {
    console.log(
      `\nИстории пока мало: больше всего у этапа ${best.stageNumber} — ${best.n} связок, ${best.events} переходов. ` +
        `Для порога по данным нужно ≥ ${STALLED_THRESHOLD.minObservations} связок, прошедших через этап, ` +
        `из них ≥ ${STALLED_THRESHOLD.minEvents} — уже перешедших дальше.`,
    )
  }

  const milestones = await funnel(REPORT_USER, { milestones: true }, now)
  console.log(`\nВоронка по вехам (связок: ${milestones.total})`)
  for (const step of milestones.steps) {
    console.log(
      `  ${pad(step.title, 40)} ${left(String(step.reached), 4)}  от начала ${left(percent(step.conversionFromStart), 4)}` +
        `  от предыдущего ${left(percent(step.conversionFromPrevious), 4)}` +
        (step.medianDaysFromPrevious !== null ? `  медиана перехода ${step.medianDaysFromPrevious} дн.` : '') +
        (step.droppedCount > 0 ? `  остановились: ${step.droppedCount}` : ''),
    )
  }

  const cohortTable = await cohorts(REPORT_USER, now)
  console.log(`\nКогорты: доля «${cohortTable.milestone.title}» к концу квартала с начала`)
  for (const cohort of cohortTable.cohorts) {
    const cells = cohort.cells.map((cell) => `${percent(cell.share)}${cell.complete ? '' : '*'}`).join('  ')
    console.log(`  ${cohort.cohort} (${cohort.size}): ${cells}`)
  }
  console.log('  * квартал ещё идёт')

  const list = await insights(REPORT_USER, now)
  console.log(`\nСистема заметила (${list.length})`)
  for (const item of list) {
    console.log(`  [${item.severity}] ${item.title}`)
    console.log(`      ${item.detail}`)
  }
  return 0
}

main()
  .then(async (code) => {
    await prisma.$disconnect()
    process.exit(code)
  })
  .catch(async (error: unknown) => {
    console.error('Отчёт не построен:', error instanceof Error ? error.message : String(error))
    await prisma.$disconnect().catch(() => {})
    process.exit(1)
  })
