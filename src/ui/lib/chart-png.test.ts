import { describe, expect, it } from 'vitest'
import { chartFileName } from './chart-png'

describe('имя файла диаграммы', () => {
  const day = new Date(2026, 8, 28)

  it('латиницей, с датой: skilllink-<название>-<дата>.png', () => {
    expect(chartFileName('Связки по вузам', day)).toBe('skilllink-svyazki-po-vuzam-2026-09-28.png')
  })

  it('знаки и лишние дефисы убираются, пустое название — «diagramma»', () => {
    expect(chartFileName('Воронка: «этапы» (все)', day)).toBe('skilllink-voronka-etapy-vse-2026-09-28.png')
    expect(chartFileName('…', day)).toBe('skilllink-diagramma-2026-09-28.png')
  })
})
