import type { Metric } from '@/shared/contracts/common'
import type { Prisma } from '@/generated/prisma/client'
import type { DataOrigin } from '@/shared/contracts/enums'
import { DATA_ORIGIN_LABELS } from '@/shared/contracts/labels'
import { toIso } from '@/shared/utils/date'

/**
 * Действующая программа — та, что учитывается в аналитике: рейтинге, покрытии
 * навыков, правилах рекомендаций.
 *
 * Условие одно на все такие запросы и учитывает вуз. Одного «программа не в архиве»
 * мало: программы архивного вуза остались бы действующими — сдвигали бы шкалу
 * рейтинга, попадали в лучшие программы, закрывали дефициты навыков и порождали
 * рекомендации «нет данных по программе». Вернуть программу из архива при
 * архивном вузе нельзя (programs.service) — значит, и считать её нельзя.
 */
export const ACTIVE_PROGRAM_WHERE = {
  status: 'ACTIVE',
  archivedAt: null,
  university: { archivedAt: null },
} as const satisfies Prisma.EducationalProgramWhereInput

/**
 * Оборачивает показатель набора вместе с его происхождением.
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

  const origin = source ? DATA_ORIGIN_LABELS[source] : 'источник не указан'
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
