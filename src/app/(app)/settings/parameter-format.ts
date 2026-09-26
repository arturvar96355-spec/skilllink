import type { CalculationParameterDto } from '@/shared/contracts'
import { formatNumber, formatShare, NO_DATA } from '@/ui/lib/format'

/**
 * «Настройки → Параметры расчётов» (решение 107, только чтение): подпись
 * значения по единице измерения (`ParameterUnit`) — отдельно от компонента,
 * чтобы разбор проверял тест, а не глаза на экране.
 */

const decimalFormat = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 })

const UNIT_SUFFIX: Partial<Record<CalculationParameterDto['unit'], string>> = {
  days: 'дн.',
  minutes: 'мин.',
}

/**
 * `Array.isArray` не сужает `readonly T[]` в объединении (он не подтип `any[]`),
 * поэтому здесь свой предикат — тип поля `CalculationParameterDto.value`.
 */
function isReadonlyArray(value: unknown): value is readonly (number | string)[] {
  return Array.isArray(value)
}

function formatOne(value: number | boolean | string, unit: CalculationParameterDto['unit']): string {
  switch (unit) {
    case 'weight':
      return typeof value === 'number' ? decimalFormat.format(value) : String(value)
    case 'share':
      return typeof value === 'number' ? formatShare(value) : String(value)
    case 'days':
    case 'minutes':
    case 'count':
    case 'points':
      return typeof value === 'number' ? `${formatNumber(value)} ${UNIT_SUFFIX[unit] ?? ''}`.trim() : String(value)
    case 'stage':
      return typeof value === 'number' ? `этап ${formatNumber(value)}` : String(value)
    case 'flag':
      return value === true ? 'Да' : 'Нет'
    default:
      return String(value)
  }
}

/** Значение параметра словами — по его единице измерения. */
export function formatParameterValue(param: CalculationParameterDto): string {
  if (param.unit === 'choice') return param.valueLabel ?? String(param.value)
  if (param.unit === 'list') {
    const items = isReadonlyArray(param.value) ? param.value : [param.value]
    if (items.length === 0) return NO_DATA
    return items.map((item) => String(item)).join(', ')
  }
  const value = param.value
  if (isReadonlyArray(value)) return value.map((item) => String(item)).join(', ')
  return formatOne(value, param.unit)
}
