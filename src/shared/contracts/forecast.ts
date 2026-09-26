/**
 * Прогноз «дойдёт ли связка до подписанного договора» (решение 132).
 * Формулы и ограничения — docs/FORECAST_MODEL.md.
 */

/** Итог обучения модели по воротам публикации. */
export type ForecastModelStatus = 'published' | 'baseline_better' | 'insufficient_data'

/**
 * Статус прогноза конкретной связки.
 *
 * - `preliminary` — прогноз модели («Предварительная оценка»: данных пока мало и они демонстрационные);
 * - `stale` — прогноз модели, но модель устарела: обучена давно или данные сильно сдвинулись;
 * - `baseline_better` — модель не обогнала простое правило, отдаётся оценка правила;
 * - `insufficient_data` — модели не на чем учиться, отдаётся оценка правила или ничего;
 * - `reached` — все ключевые вехи уже пройдены;
 * - `not_applicable` — связка закрыта (завершена или отменена), прогноз не нужен.
 */
export type ForecastStatus =
  | 'preliminary'
  | 'stale'
  | 'baseline_better'
  | 'insufficient_data'
  | 'reached'
  | 'not_applicable'

export const FORECAST_STATUS_LABELS: Record<ForecastStatus, string> = {
  preliminary: 'Предварительная оценка',
  stale: 'Прогноз устарел',
  baseline_better: 'Предварительная оценка по правилу',
  insufficient_data: 'Недостаточно данных',
  reached: 'Веха достигнута',
  not_applicable: 'Связка закрыта',
}

export const FORECAST_MODEL_STATUS_LABELS: Record<ForecastModelStatus, string> = {
  published: 'Модель опубликована',
  baseline_better: 'Правило не хуже модели — используется правило',
  insufficient_data: 'Недостаточно данных',
}

/** Откуда вероятность: логистическая модель или простое правило (частота по этапу). */
export type ForecastSource = 'model' | 'baseline'

export interface ForecastExplanationItemDto {
  /** Ключ признака; для оценки правилом — `stageNumber`. */
  feature: string
  title: string
  /** Значение признака у связки. */
  value: number
  /** Вклад в логит: коэффициент × стандартизованное значение. null — у правила вкладов нет. */
  contribution: number | null
  /** «за» — повышает вероятность, «против» — понижает, `info` — пояснение правила. */
  direction: 'for' | 'against' | 'info'
  /** Обычная русская фраза: «3 встречи за месяц — больше, чем у 80% связок». */
  text: string
}

export interface ForecastMilestoneDto {
  stageNumber: number
  stageTitle: string
  /** «подписанного договора», «проведения занятий». */
  goal: string
}

export interface CooperationForecastDto {
  cooperationId: string
  /** Веха, к которой строится прогноз; null — все пройдены или связка закрыта. */
  milestone: ForecastMilestoneDto | null
  horizonDays: number | null
  /** Вероятность дойти до вехи за horizonDays дней, 0…1. null — оценки нет. */
  probability: number | null
  source: ForecastSource
  status: ForecastStatus
  statusLabel: string
  /** Одна фраза: что это за число и откуда. */
  summary: string
  /** До трёх причин «за» и до трёх «против» — по убыванию силы. */
  explanation: ForecastExplanationItemDto[]
  /** Оговорки: связка на паузе, модель устарела и почему. */
  notes: string[]
  modelVersion: number | null
  trainedAt: string | null
  /** В обучении или у связки — демонстрационные данные. */
  isMock: boolean
  generatedAt: string
}

export interface ForecastCalibrationBinDto {
  from: number
  to: number
  count: number
  meanPredicted: number | null
  observedRate: number | null
}

export interface ForecastGateCheckDto {
  key: 'snapshots' | 'positives' | 'negatives' | 'aucGain' | 'aboveChance' | 'training'
  passed: boolean
  text: string
}

export interface ForecastMetricsDto {
  /** AUC модели на поздних снимках (временное разбиение). */
  auc: number | null
  /** Нижняя граница 95% интервала AUC (Хэнли — Макнил). */
  aucLower: number | null
  baselineAuc: number | null
  brier: number | null
  baselineBrier: number | null
  /** Проверочная выборка: снимков, из них дошедших до вехи, разных связок. */
  n: number
  positives: number
  cooperations: number
  /** Обучающая выборка. */
  trainN: number
  trainPositives: number
  /** Граница временного разбиения: обучение — снимки, чей исход известен к этой дате; проверка — позже. */
  splitAt: string | null
  calibration: ForecastCalibrationBinDto[]
  gate: ForecastGateCheckDto[]
  iterations: number | null
  converged: boolean | null
  lambda: number
}

export interface ForecastCoefficientDto {
  feature: string
  title: string
  /** Коэффициент при стандартизованном признаке: на сколько меняется логит при +1σ. */
  weight: number
  /** Во сколько раз меняются шансы при +1σ: e^weight. */
  oddsRatio: number
  mean: number
  std: number
}

export interface ForecastDriftDto {
  feature: string
  title: string
  /** null — текущих связок слишком мало, сдвиг не считается. */
  psi: number | null
}

export interface ForecastModelDto {
  milestone: ForecastMilestoneDto
  horizonDays: number
  /** null — модель по этой вехе ещё не обучалась. */
  version: number | null
  trainedAt: string | null
  status: ForecastModelStatus
  statusLabel: string
  /** Модель устарела: обучена больше 14 дней назад или PSI признака выше 0,25. */
  isStale: boolean
  staleReasons: string[]
  metrics: ForecastMetricsDto | null
  intercept: number | null
  coefficients: ForecastCoefficientDto[]
  drift: ForecastDriftDto[]
  /** Сколько текущих связок участвовало в расчёте сдвига. */
  driftSample: number
  isMock: boolean
}

export interface ForecastModelsDto {
  models: ForecastModelDto[]
  generatedAt: string
}
