import { AUDIT_CHAIN_BREAK_LABELS, type AuditChainVerifyDto } from '@/shared/contracts'
import { formatCount } from '@/ui/lib/format'

/**
 * Итог проверки целостности журнала (решение 115, `GET /api/audit/verify`) —
 * одной фразой, понятной без чтения кодов нарушения.
 *
 * Чистая функция без React: вкладка «Журнал действий» только показывает то,
 * что она вернула, а проверяется она тестом (audit-chain-view.test.ts).
 */
export function describeChainVerify(result: AuditChainVerifyDto): string {
  if (result.ok) {
    return result.checked === 0
      ? 'Журнал пуст — проверять нечего.'
      : `Цепочка цела: ${formatCount(result.checked, ['запись', 'записи', 'записей'])} проверено.`
  }

  const where = result.brokenAt !== null ? ` на записи №${result.brokenAt}` : ''
  const label = (result.code && AUDIT_CHAIN_BREAK_LABELS[result.code]) || 'нарушение не опознано'
  const reason = result.reason ? ` ${result.reason}` : ''
  return `Цепочка нарушена${where}: ${label}.${reason}`
}
