import type { Metric } from '@/shared/contracts/common'
import type { DataOrigin } from '@/shared/contracts/enums'
import { toIso } from '@/shared/utils/date'

const ORIGIN_LABELS: Record<DataOrigin, string> = {
  CURRICULUM: 'учебный план',
  EXPERT: 'экспертная оценка',
  INTEGRATION: 'интеграция',
  IMPORT: 'импорт данных',
  MANUAL: 'ручной ввод',
  MOCK: 'демонстрационные данные',
}

/**
 * Оборачивает показатель набора вместе с его происхождением (решение 8).
 * Отсутствие данных — это null и пояснение «Нет данных», никогда не 0.
 */
export function toMetric(
  value: number | null,
  unit: string,
  title: string,
  source: DataOrigin | null,
  updatedAt: Date | null,
  isMock: boolean,
): Metric {
  if (value === null) {
    return {
      value: null,
      unit,
      basis: 'none',
      explanation: `Нет данных: ${title.toLowerCase()} не заполнено`,
      source: null,
      period: null,
      isMock,
    }
  }

  const origin = source ? ORIGIN_LABELS[source] : 'источник не указан'
  const isEstimate = source === 'EXPERT' || source === 'MOCK'
  return {
    value,
    unit,
    basis: isEstimate ? 'estimate' : 'actual',
    explanation: `${title}: ${value} (${origin})`,
    source: source,
    period: toIso(updatedAt),
    isMock: isMock || source === 'MOCK',
  }
}
