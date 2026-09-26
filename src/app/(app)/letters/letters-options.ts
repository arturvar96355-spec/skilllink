import {
  INBOUND_LETTER_GROUP_LABELS,
  INBOUND_LETTER_GROUPS,
  INBOUND_LETTER_STATUS_LABELS,
  INBOUND_LETTER_STATUSES,
} from '@/shared/contracts'
import type { SelectOption } from '@/ui'

/**
 * Варианты выпадающих списков «Письма вузов» — общие для реестра (фильтры)
 * и карточки (форма «Неверно»), чтобы подписи групп не разошлись.
 */

export const INBOUND_LETTER_STATUS_OPTIONS: SelectOption[] = INBOUND_LETTER_STATUSES.map((value) => ({
  value,
  label: INBOUND_LETTER_STATUS_LABELS[value],
}))

export const INBOUND_LETTER_GROUP_OPTIONS: SelectOption[] = INBOUND_LETTER_GROUPS.map((value) => ({
  value,
  label: INBOUND_LETTER_GROUP_LABELS[value],
}))
