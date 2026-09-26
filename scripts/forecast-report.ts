/**
 * Печать метрик и калибровки модели прогноза в консоль — для слайда презентации
 * (решение 132). Ничего не меняет и не обучает: только читает последнюю сохранённую
 * модель каждой вехи. Обучить заново — `npm run forecast:train`.
 *
 *   npm run forecast:report
 */

import 'dotenv/config'
import { prisma } from '@/shared/db/prisma'
import { readModels } from '@/modules/analytics/forecast.service'
import { FORECAST_MODEL_STATUS_LABELS } from '@/shared/contracts/forecast'

const percent = (value: number) => `${(value * 100).toFixed(1)}%`
const number3 = (value: number | null) => (value === null ? '—' : value.toFixed(3))

async function main(): Promise<number> {
  if (!process.env.DATABASE_URL) {
    console.error('Не задана переменная окружения DATABASE_URL')
    return 1
  }

  const report = await readModels()
  console.log(`Прогноз связок — отчёт на ${report.generatedAt}\n`)

  for (const model of report.models) {
    console.log(`── ${model.milestone.stageTitle} (этап ${model.milestone.stageNumber}, горизонт ${model.horizonDays} дн.) ──`)
    console.log(`Статус: ${FORECAST_MODEL_STATUS_LABELS[model.status]}${model.isStale ? ' — прогноз устарел' : ''}`)
    if (model.version === null) {
      console.log('Модель ещё не обучалась. Запустите npm run forecast:train.\n')
      continue
    }
    console.log(`Версия ${model.version}, обучена ${model.trainedAt}`)
    for (const reason of model.staleReasons) console.log(`  ! ${reason}`)

    const m = model.metrics
    if (m) {
      console.log(
        `AUC модели ${number3(m.auc)} (правило ${number3(m.baselineAuc)}), ` +
          `Brier ${number3(m.brier)} (правило ${number3(m.baselineBrier)})`,
      )
      console.log(`Проверка: ${m.n} снимков, ${m.positives} дошли, ${m.cooperations} разных связок`)
      console.log('Ворота публикации:')
      for (const check of m.gate) console.log(`  ${check.passed ? '+' : '-'} ${check.text}`)
      console.log('Калибровка (5 корзин):')
      for (const bin of m.calibration) {
        const predicted = bin.meanPredicted === null ? '—' : percent(bin.meanPredicted)
        const observed = bin.observedRate === null ? '—' : percent(bin.observedRate)
        console.log(`  [${percent(bin.from)}; ${percent(bin.to)}] n=${bin.count} — предсказано ${predicted}, по факту ${observed}`)
      }
    }

    if (model.coefficients.length > 0) {
      console.log('Коэффициенты (по силе влияния, +1σ признака меняет шансы в oddsRatio раз):')
      const sorted = [...model.coefficients].sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight))
      for (const item of sorted) {
        console.log(`  ${item.title}: вес ${number3(item.weight)}, oddsRatio ${item.oddsRatio.toFixed(2)}`)
      }
    }
    console.log('')
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
