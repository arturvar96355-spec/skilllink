/**
 * Маленький реестр метрик в текстовом формате Prometheus 0.0.4 (решение 137).
 *
 * Своя реализация вместо клиентской библиотеки: нужно три типа (счётчик, датчик,
 * гистограмма) и вывод текста — это сотня строк без зависимостей, а библиотека
 * тянет свои сборщики и глобальное состояние, которые пришлось бы отключать.
 *
 * Формат: https://prometheus.io/docs/instrumenting/exposition_formats/ —
 * для каждой метрики строки `# HELP` и `# TYPE`, затем ряды `имя{метки} значение`.
 * У гистограммы — накопительные ряды `_bucket{le="…"}`, последний `le="+Inf"`,
 * и `_sum`, `_count`.
 *
 * **Кардинальность ограничена.** Каждый новый набор меток — новый ряд в памяти
 * процесса и в базе Prometheus. Метки со значениями из запроса (адрес, id записи)
 * сюда не передаются вовсе — маршрут приходит шаблоном (routes.ts). На случай
 * ошибки у каждой метрики предел рядов: сверх него новые наборы не заводятся,
 * а считаются в `metrics_series_dropped_total`.
 */

export type Labels = Record<string, string>

export type MetricType = 'counter' | 'gauge' | 'histogram'

/** Столько рядов на метрику — с запасом: маршрутов × методов × классов ответа меньше. */
export const MAX_SERIES_PER_METRIC = 2000

const NAME = /^[a-zA-Z_:][a-zA-Z0-9_:]*$/
const LABEL_NAME = /^[a-zA-Z_][a-zA-Z0-9_]*$/

/** Значение метки: обратная косая, кавычка и перевод строки экранируются. */
export function escapeLabelValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')
}

/** Текст HELP: экранируются только обратная косая и перевод строки. */
function escapeHelp(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\n/g, '\\n')
}

/** Число в записи формата: `+Inf`, `-Inf`, `NaN`, остальное — как в JavaScript. */
export function formatValue(value: number): string {
  if (Number.isNaN(value)) return 'NaN'
  if (value === Infinity) return '+Inf'
  if (value === -Infinity) return '-Inf'
  return String(value)
}

function renderLabels(names: readonly string[], values: readonly string[], extra?: [string, string]): string {
  const pairs = names.map((name, index) => `${name}="${escapeLabelValue(values[index] ?? '')}"`)
  if (extra) pairs.push(`${extra[0]}="${escapeLabelValue(extra[1])}"`)
  return pairs.length === 0 ? '' : `{${pairs.join(',')}}`
}

abstract class Metric<Series> {
  protected readonly series = new Map<string, { values: string[]; data: Series }>()

  constructor(
    readonly name: string,
    readonly help: string,
    readonly type: MetricType,
    readonly labelNames: readonly string[],
    private readonly onDrop: () => void,
  ) {
    if (!NAME.test(name)) throw new Error(`Недопустимое имя метрики: ${name}`)
    for (const label of labelNames) {
      if (!LABEL_NAME.test(label) || label.startsWith('__') || label === 'le') {
        throw new Error(`Недопустимое имя метки ${label} у ${name}`)
      }
    }
  }

  protected abstract create(): Series

  /** Ряд для набора меток; `null` — предел рядов исчерпан, значение отброшено. */
  protected seriesFor(labels: Labels = {}, create = true): Series | null {
    const values = this.labelNames.map((name) => {
      const value = labels[name]
      if (value === undefined) throw new Error(`У метрики ${this.name} не задана метка ${name}`)
      return value
    })
    const key = values.join('\u0000')
    const existing = this.series.get(key)
    if (existing) return existing.data
    if (!create) return null
    if (this.series.size >= MAX_SERIES_PER_METRIC) {
      this.onDrop()
      return null
    }
    const data = this.create()
    this.series.set(key, { values, data })
    return data
  }

  /** Убрать все ряды: датчики, которые пересчитываются при каждом сборе. */
  reset(): void {
    this.series.clear()
  }

  protected abstract renderSeries(values: string[], data: Series): string[]

  render(): string {
    const lines = [`# HELP ${this.name} ${escapeHelp(this.help)}`, `# TYPE ${this.name} ${this.type}`]
    for (const { values, data } of this.series.values()) lines.push(...this.renderSeries(values, data))
    return lines.join('\n')
  }
}

export class Counter extends Metric<{ value: number }> {
  protected create() {
    return { value: 0 }
  }

  /** Счётчик только растёт: отрицательное приращение — ошибка в коде. */
  inc(labels?: Labels, amount = 1): void {
    if (!(amount >= 0)) throw new Error(`Счётчик ${this.name} не уменьшается`)
    const data = this.seriesFor(labels)
    if (data) data.value += amount
  }

  /**
   * Накопленное значение из внешнего источника (процессорное время процесса):
   * счётчик ведёт не приложение, а система, и сюда приходит уже сумма.
   */
  sync(total: number, labels?: Labels): void {
    const data = this.seriesFor(labels)
    if (data) data.value = total
  }

  /** Текущее значение (для тестов и сборщиков); ряд не заводит. */
  get(labels?: Labels): number {
    return this.seriesFor(labels, false)?.value ?? 0
  }

  protected renderSeries(values: string[], data: { value: number }): string[] {
    return [`${this.name}${renderLabels(this.labelNames, values)} ${formatValue(data.value)}`]
  }
}

export class Gauge extends Metric<{ value: number }> {
  protected create() {
    return { value: 0 }
  }

  set(value: number, labels?: Labels): void {
    const data = this.seriesFor(labels)
    if (data) data.value = value
  }

  protected renderSeries(values: string[], data: { value: number }): string[] {
    return [`${this.name}${renderLabels(this.labelNames, values)} ${formatValue(data.value)}`]
  }
}

interface HistogramData {
  /** Попаданий в каждый бакет — НЕ накопительно; накопление — при выводе. */
  counts: number[]
  sum: number
  count: number
}

export class Histogram extends Metric<HistogramData> {
  readonly buckets: readonly number[]

  constructor(
    name: string,
    help: string,
    labelNames: readonly string[],
    buckets: readonly number[],
    onDrop: () => void,
  ) {
    super(name, help, 'histogram', labelNames, onDrop)
    const sorted = [...buckets].sort((a, b) => a - b)
    if (sorted.length === 0 || sorted.some((bound, index) => index > 0 && bound === sorted[index - 1])) {
      throw new Error(`Бакеты гистограммы ${name} пусты или повторяются`)
    }
    this.buckets = sorted.filter((bound) => bound !== Infinity)
  }

  protected create(): HistogramData {
    return { counts: new Array<number>(this.buckets.length).fill(0), sum: 0, count: 0 }
  }

  observe(value: number, labels?: Labels): void {
    const data = this.seriesFor(labels)
    if (!data) return
    const index = this.buckets.findIndex((bound) => value <= bound)
    if (index >= 0) data.counts[index] = (data.counts[index] ?? 0) + 1
    data.sum += value
    data.count += 1
  }

  protected renderSeries(values: string[], data: HistogramData): string[] {
    const lines: string[] = []
    let cumulative = 0
    this.buckets.forEach((bound, index) => {
      cumulative += data.counts[index] ?? 0
      lines.push(`${this.name}_bucket${renderLabels(this.labelNames, values, ['le', formatValue(bound)])} ${cumulative}`)
    })
    lines.push(`${this.name}_bucket${renderLabels(this.labelNames, values, ['le', '+Inf'])} ${data.count}`)
    lines.push(`${this.name}_sum${renderLabels(this.labelNames, values)} ${formatValue(data.sum)}`)
    lines.push(`${this.name}_count${renderLabels(this.labelNames, values)} ${data.count}`)
    return lines
  }
}

type AnyMetric = Counter | Gauge | Histogram

/** Сборщик: обновляет датчики прямо перед выводом (память, база, копия). */
export type Collector = () => void | Promise<void>

export class Registry {
  private readonly metrics = new Map<string, AnyMetric>()
  private readonly collectors: Collector[] = []
  readonly dropped: Counter

  constructor() {
    // Своему пределу этот счётчик ничего не сообщает: иначе переполненный
    // счётчик отброшенного считал бы сам себя без конца.
    this.dropped = this.add(
      new Counter(
        'metrics_series_dropped_total',
        'Значения, отброшенные из-за предела рядов метрики (ошибка в выборе меток)',
        'counter',
        ['metric'],
        () => undefined,
      ),
    )
  }

  private add<M extends AnyMetric>(metric: M): M {
    if (this.metrics.has(metric.name)) throw new Error(`Метрика ${metric.name} уже заведена`)
    this.metrics.set(metric.name, metric)
    return metric
  }

  private dropFor(name: string): () => void {
    return () => this.dropped.inc({ metric: name })
  }

  counter(name: string, help: string, labelNames: readonly string[] = []): Counter {
    return this.add(new Counter(name, help, 'counter', labelNames, this.dropFor(name)))
  }

  gauge(name: string, help: string, labelNames: readonly string[] = []): Gauge {
    return this.add(new Gauge(name, help, 'gauge', labelNames, this.dropFor(name)))
  }

  histogram(name: string, help: string, labelNames: readonly string[], buckets: readonly number[]): Histogram {
    return this.add(new Histogram(name, help, labelNames, buckets, this.dropFor(name)))
  }

  addCollector(collector: Collector): void {
    this.collectors.push(collector)
  }

  /** Текст для ответа: сначала сборщики, потом все метрики в порядке заведения. */
  async collect(): Promise<string> {
    for (const collector of this.collectors) {
      try {
        await collector()
      } catch (error) {
        // Сломанный сборщик не должен лишать остальных метрик: без них не видно
        // как раз того сбоя, из-за которого он сломался.
        console.warn('[METRICS] сборщик не отработал:', error instanceof Error ? error.message : 'ошибка')
      }
    }
    return this.render()
  }

  render(): string {
    return `${[...this.metrics.values()].map((metric) => metric.render()).join('\n')}\n`
  }
}

/** Тип содержимого текстового формата Prometheus. */
export const PROMETHEUS_CONTENT_TYPE = 'text/plain; version=0.0.4; charset=utf-8'
