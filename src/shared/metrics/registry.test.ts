import { describe, expect, it } from 'vitest'
import { MAX_SERIES_PER_METRIC, Registry, escapeLabelValue, formatValue } from './registry'

/**
 * Формат вывода реестра (решение 137): Prometheus читает текст строго, и
 * лишний пробел или неэкранированная кавычка в метке ломают разбор всей
 * страницы, а не одной строки. Поэтому — сверка с эталонной строкой целиком.
 */

describe('текстовый формат 0.0.4', () => {
  it('счётчик, датчик и гистограмма — строка в строку с эталоном', () => {
    const registry = new Registry()
    const requests = registry.counter('http_requests_total', 'Запросы', ['method', 'route'])
    const up = registry.gauge('db_up', 'База отвечает')
    const duration = registry.histogram('work_seconds', 'Время', ['kind'], [0.1, 1])

    requests.inc({ method: 'GET', route: '/api/me' })
    requests.inc({ method: 'GET', route: '/api/me' }, 2)
    requests.inc({ method: 'POST', route: '/api/universities/[id]' })
    up.set(1)
    duration.observe(0.05, { kind: 'a' })
    duration.observe(0.5, { kind: 'a' })
    duration.observe(3, { kind: 'a' })

    expect(registry.render()).toBe(
      [
        '# HELP metrics_series_dropped_total Значения, отброшенные из-за предела рядов метрики (ошибка в выборе меток)',
        '# TYPE metrics_series_dropped_total counter',
        '# HELP http_requests_total Запросы',
        '# TYPE http_requests_total counter',
        'http_requests_total{method="GET",route="/api/me"} 3',
        'http_requests_total{method="POST",route="/api/universities/[id]"} 1',
        '# HELP db_up База отвечает',
        '# TYPE db_up gauge',
        'db_up 1',
        '# HELP work_seconds Время',
        '# TYPE work_seconds histogram',
        'work_seconds_bucket{kind="a",le="0.1"} 1',
        'work_seconds_bucket{kind="a",le="1"} 2',
        'work_seconds_bucket{kind="a",le="+Inf"} 3',
        'work_seconds_sum{kind="a"} 3.55',
        'work_seconds_count{kind="a"} 3',
        '',
      ].join('\n'),
    )
  })

  it('метки экранируются: обратная косая, кавычка, перевод строки', () => {
    expect(escapeLabelValue('a\\b"c\nd')).toBe('a\\\\b\\"c\\nd')
    const registry = new Registry()
    registry.counter('x_total', 'строка\nвторая', ['v']).inc({ v: 'say "hi"' })
    const text = registry.render()
    expect(text).toContain('# HELP x_total строка\\nвторая')
    expect(text).toContain('x_total{v="say \\"hi\\""} 1')
  })

  it('особые числа записываются как в формате', () => {
    expect(formatValue(Infinity)).toBe('+Inf')
    expect(formatValue(-Infinity)).toBe('-Inf')
    expect(formatValue(Number.NaN)).toBe('NaN')
    expect(formatValue(0.025)).toBe('0.025')
  })

  it('неверные имена и забытые метки — ошибка в коде, а не тихий мусор', () => {
    const registry = new Registry()
    expect(() => registry.counter('bad-name', 'x')).toThrow()
    expect(() => registry.counter('ok_total', 'x', ['le'])).toThrow()
    const counter = registry.counter('ok_total', 'x', ['a'])
    expect(() => counter.inc({})).toThrow()
    expect(() => counter.inc({ a: '1' }, -1)).toThrow()
    expect(() => registry.counter('ok_total', 'x')).toThrow()
  })

  it('сборщики вызываются перед выводом, сломанный не мешает остальным', async () => {
    const registry = new Registry()
    const gauge = registry.gauge('g', 'g')
    registry.addCollector(() => {
      throw new Error('сбой')
    })
    registry.addCollector(async () => gauge.set(7))
    const warn = console.warn
    console.warn = () => undefined
    try {
      expect(await registry.collect()).toContain('\ng 7\n')
    } finally {
      console.warn = warn
    }
  })
})

describe('гистограмма', () => {
  it('бакеты накопительные, sum и count — по всем наблюдениям', () => {
    const registry = new Registry()
    const histogram = registry.histogram('h_seconds', 'h', [], [0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10])
    const values = [0.01, 0.02, 0.03, 0.2, 0.2, 0.9, 4, 12]
    for (const value of values) histogram.observe(value)

    const buckets = [...registry.render().matchAll(/^h_seconds_bucket\{le="([^"]+)"\} (\d+)$/gm)].map(
      (match) => [match[1], Number(match[2])] as const,
    )
    expect(buckets).toEqual([
      ['0.025', 2],
      ['0.05', 3],
      ['0.1', 3],
      ['0.25', 5],
      ['0.5', 5],
      ['1', 6],
      ['2.5', 6],
      ['5', 7],
      ['10', 7],
      ['+Inf', 8],
    ])
    // Накопительность: каждый следующий не меньше предыдущего, +Inf = count.
    for (let index = 1; index < buckets.length; index += 1) {
      expect(buckets[index]![1]).toBeGreaterThanOrEqual(buckets[index - 1]![1])
    }
    const text = registry.render()
    expect(text).toMatch(/^h_seconds_count 8$/m)
    const sum = Number(/^h_seconds_sum (\S+)$/m.exec(text)?.[1])
    expect(sum).toBeCloseTo(values.reduce((total, value) => total + value, 0), 10)
  })

  it('значение ровно на границе попадает в этот бакет (le — «меньше или равно»)', () => {
    const registry = new Registry()
    const histogram = registry.histogram('b', 'b', [], [1, 2])
    histogram.observe(1)
    expect(registry.render()).toContain('b_bucket{le="1"} 1')
  })

  it('бакеты сортируются, повторы и пустой список запрещены', () => {
    const registry = new Registry()
    const histogram = registry.histogram('s', 's', [], [5, 1, 2])
    expect(histogram.buckets).toEqual([1, 2, 5])
    expect(() => registry.histogram('d', 'd', [], [1, 1])).toThrow()
    expect(() => registry.histogram('e', 'e', [], [])).toThrow()
  })
})

describe('предел рядов', () => {
  it('сверх предела новые наборы меток не заводятся, а считаются отброшенными', () => {
    const registry = new Registry()
    const counter = registry.counter('many_total', 'm', ['id'])
    for (let index = 0; index < MAX_SERIES_PER_METRIC + 5; index += 1) counter.inc({ id: String(index) })
    const text = registry.render()
    expect(text.match(/^many_total\{/gm)).toHaveLength(MAX_SERIES_PER_METRIC)
    expect(text).toContain('metrics_series_dropped_total{metric="many_total"} 5')
    // Уже заведённый ряд продолжает считать.
    counter.inc({ id: '0' })
    expect(counter.get({ id: '0' })).toBe(2)
  })
})
