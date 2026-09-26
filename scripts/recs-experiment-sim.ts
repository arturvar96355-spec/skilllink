/**
 * Симуляция эксперимента для слайда на защите (решение 126).
 *
 *   npm run recs:experiment-sim
 *
 * Без базы: детерминированный генератор псевдослучайных чисел (Mulberry32) создаёт
 * полгода выдуманных сигналов с заранее известным эффектом (вероятность перехода
 * связки за окно исхода — 30 % в контроле против 42 % в treatment) и без эффекта
 * (по 30 % в обеих группах), затем оба набора проходят через тот же код, что
 * считает отчёт по настоящим данным (`experiment/report.ts`). Показывает: с эффектом
 * интервал находит и накрывает заложенный прирост и статус — «прирост есть»; без
 * эффекта — «прирост не доказан». Дополнительно — калибровка на многих зёрнах:
 * как часто 95 % интервал вообще накрывает правду (должно быть близко к 95 %).
 */

import { calibrate, simulate, type SimulationScenario } from '@/modules/recommendations/experiment/simulation'
import { EXPERIMENT_STATUS_LABELS } from '@/shared/contracts/recommendation-experiment'
import type { ReportSettings } from '@/modules/recommendations/experiment/report'

const REPORT_SETTINGS: Omit<ReportSettings, 'enabled' | 'controlShare' | 'horizonDays'> = {
  minControlForVerdict: 30,
  confidenceLevel: 0.95,
  sequentialAlpha: 0.05,
  sequentialBeta: 0.2,
  sequentialRelativeLift: 0.3,
  neverControlRules: [],
}

const BASE: Omit<SimulationScenario, 'name' | 'pTreatment'> = {
  seed: 20260926,
  days: 182, // полгода
  signalsPerDay: 6,
  pControl: 0.3,
  controlShare: 0.1,
  horizonDays: 30,
}

const SCENARIOS: SimulationScenario[] = [
  { ...BASE, name: 'С эффектом: рекомендация повышает вероятность перехода с 30 % до 42 %', pTreatment: 0.42 },
  { ...BASE, name: 'Без эффекта: 30 % в обеих группах', pTreatment: 0.3 },
]

function pct(value: number | null): string {
  return value === null ? '—' : `${(value * 100).toFixed(1)} %`
}

function main(): void {
  for (const scenario of SCENARIOS) {
    const { report, trueLift } = simulate(scenario, REPORT_SETTINGS)
    console.log(`\n${scenario.name}`)
    console.log(`  сигналов в журнале: ${report.journal.total}, по хешу: ${report.journal.randomized} ` +
      `(treatment ${report.overall.nTreatment + report.overall.pendingTreatment}, ` +
      `control ${report.overall.nControl + report.overall.pendingControl})`)
    console.log(`  заложенный прирост: ${pct(trueLift)}`)
    console.log(`  найденный прирост: ${pct(report.overall.lift)}, 95 % интервал ` +
      `${report.overall.ci ? `[${pct(report.overall.ci.low)}; ${pct(report.overall.ci.high)}]` : '—'}` +
      `${report.overall.ci && report.overall.ci.low <= trueLift && trueLift <= report.overall.ci.high ? ' — накрывает правду' : ''}`)
    console.log(`  статус: ${EXPERIMENT_STATUS_LABELS[report.overall.status]}`)
    console.log(`  последовательная проверка: ${report.overall.sequential.decision}`)
  }

  console.log('\nКалибровка (100 прогонов на разных зёрнах): как часто 95 % интервал накрывает заложенный прирост')
  for (const scenario of SCENARIOS) {
    const calibration = calibrate(scenario, REPORT_SETTINGS, 100)
    console.log(`  ${scenario.name}`)
    console.log(`    покрытие интервала: ${pct(calibration.coverage)} (заявлено 95 %)`)
    console.log(`    доля прогонов со статусом «прирост есть»: ${pct(calibration.liftShare)}`)
    console.log(`    доля прогонов, где проверка Вальда остановилась на «прирост есть»: ${pct(calibration.sequentialLiftShare)}`)
  }
}

main()
