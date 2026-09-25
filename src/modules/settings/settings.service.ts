import { assertCan } from '@/shared/auth/permissions'
import type { CurrentUser } from '@/shared/auth/current-user'
import type { CalculationParametersDto } from '@/shared/contracts/settings'
import { buildCalculationParameters } from './settings.rules'

/**
 * Параметры расчётов (решение 107) — всем, кто видит аналитику: ADMIN, MANAGER,
 * ANALYST и VIEWER. Это не настройки, а объяснение чисел, которые эти роли и так
 * видят в рейтинге, дефицитах и рекомендациях; менять здесь нечего. Представителю
 * вуза закрыто, как и сама аналитика (решение 9).
 */
export function getCalculationParameters(user: CurrentUser): CalculationParametersDto {
  assertCan(user, 'ANALYTICS')
  return buildCalculationParameters()
}
