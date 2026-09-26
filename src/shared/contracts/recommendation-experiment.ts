/**
 * «Работают ли рекомендации» — контрольная группа и оценка прироста (решение 136).
 * Ответ `GET /api/recommendations/experiment`.
 */

/** treatment — рекомендацию показали, control — придержали для сравнения. */
export type ExperimentArm = 'treatment' | 'control'

/**
 * Вывод по сравнению групп:
 * `insufficient-data` — в контроле (или в группе) меньше порога исходов, вывода нет;
 * `not-proven` — интервал разности содержит 0, прирост не доказан;
 * `lift` — весь интервал выше 0, прирост есть;
 * `negative` — весь интервал ниже 0: с рекомендацией объекты движутся хуже.
 */
export type ExperimentStatus = 'insufficient-data' | 'not-proven' | 'lift' | 'negative'

export const EXPERIMENT_STATUS_LABELS: Record<ExperimentStatus, string> = {
  'insufficient-data': 'Мало данных',
  'not-proven': 'Прирост не доказан',
  lift: 'Прирост есть',
  negative: 'С рекомендацией хуже',
}

export type ExperimentSequentialDecision = 'lift' | 'no-lift' | 'continue'

export const EXPERIMENT_SEQUENTIAL_LABELS: Record<ExperimentSequentialDecision, string> = {
  lift: 'Можно остановить: прирост есть',
  'no-lift': 'Можно остановить: прироста нужного размера нет',
  continue: 'Продолжать сбор',
}

export interface ExperimentIntervalDto {
  low: number
  high: number
}

/** Сравнение групп — по правилу или по всем правилам вместе. */
export interface ExperimentStatsDto {
  /** Сигналов с известным исходом (окно H дней закрылось или исход наступил). */
  nTreatment: number
  nControl: number
  successesTreatment: number
  successesControl: number
  /** Конверсия — доля сигналов, после которых объект сдвинулся за H дней; null — нет сигналов. */
  convT: number | null
  convC: number | null
  /** Абсолютный прирост convT − convC (доля, 0,12 = 12 п. п.); null — нет одной из групп. */
  lift: number | null
  /** Относительный прирост (convT − convC) / convC; null — нет групп или convC = 0. */
  relativeLift: number | null
  /** 95 % интервал абсолютного прироста (метод 10 Ньюкомба); null — нет одной из групп. */
  ci: ExperimentIntervalDto | null
  /**
   * Дни до сдвига (не сдвинулся за H — H дней): средние групп и разность treatment − control
   * с интервалом Уэлча. Отрицательная разность — с рекомендацией быстрее. null — меньше двух
   * сигналов в группе.
   */
  days: {
    meanTreatment: number
    meanControl: number
    diff: number
    ci: ExperimentIntervalDto
    df: number
  } | null
  /** Последовательная проверка Вальда: можно ли остановиться раньше. */
  sequential: {
    llr: number
    upper: number
    lower: number
    decision: ExperimentSequentialDecision
    conversions: number
  }
  status: ExperimentStatus
  statusLabel: string
  /** Сигналов, чьё окно ещё не закрылось, — в сравнение пока не входят. */
  pendingTreatment: number
  pendingControl: number
  /** Первый сигнал, назначенный в группу по хешу; null — таких нет. */
  since: string | null
}

export interface ExperimentRuleStatsDto extends ExperimentStatsDto {
  ruleType: string
  /** Подпись правила по-русски. */
  label: string
  /** Может ли правило вообще уходить в контроль (просрочки — никогда). */
  controlEligible: boolean
}

export interface RecommendationExperimentDto {
  /** Включён ли эксперимент (RECOMMENDATION_EXPERIMENT=on). */
  enabled: boolean
  /** Доля контроля c (0…0,25). */
  controlShare: number
  /** Окно исхода H, дней. */
  horizonDays: number
  /** Порог «мало данных»: столько исходов нужно в контроле. */
  minControlForVerdict: number
  confidenceLevel: number
  /** Все правила вместе — только сигналы, назначенные по хешу. */
  overall: ExperimentStatsDto
  rules: ExperimentRuleStatsDto[]
  /** Журнал сигналов: сколько всего и как назначены (hash, experiment-off, excluded-rule, …). */
  journal: {
    total: number
    randomized: number
    byAssignment: Record<string, number>
  }
  /** Оговорки к числам: например, доля контроля менялась по ходу эксперимента. */
  warnings: string[]
  generatedAt: string
}

/** Подписи правил в отчёте. Правила, которых здесь нет, подписываются своим ключом. */
export const EXPERIMENT_RULE_LABELS: Record<string, string> = {
  'stage.overdue': 'Просрочен этап',
  'cooperation.stalled': 'Связка без движения',
  'cooperation.no-product': 'Связка без IT-продукта',
  'program.missing-metrics': 'Нет данных по программе',
  'skill.critical-gap-with-product': 'Дефицит навыка закрывается нашим продуктом',
}
