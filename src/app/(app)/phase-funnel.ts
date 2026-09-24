import {
  STAGE_PHASES,
  STAGE_PHASE_LABELS,
  type CooperationListItemDto,
} from '@/shared/contracts'
import type { FunnelStep } from '@/ui/data/Funnel'
import { pluralize } from '@/ui/lib/format'

/**
 * Воронка связок по фазам конвейера (решение 74): сколько связок дошло до каждой фазы.
 *
 * Фаза связки — фаза её текущего этапа (первый не закрытый, решение 5); у связки
 * без текущего этапа закрыты все этапы — она прошла все фазы. «Дошла до фазы» —
 * текущая фаза не раньше этой: связка на «Внедрении» уже прошла «Привлечение»
 * и «Оформление». Отменённые связки в воронку не входят — их передаёт не вызывающий.
 */
export function phaseFunnel(cooperations: CooperationListItemDto[]): FunnelStep[] {
  const positions = cooperations.map((item) =>
    item.currentStage ? STAGE_PHASES.indexOf(item.currentStage.phase) : STAGE_PHASES.length,
  )
  return STAGE_PHASES.map((phase, index) => {
    const reached = positions.filter((position) => position >= index).length
    const here = positions.filter((position) => position === index).length
    return {
      key: phase,
      label: STAGE_PHASE_LABELS[phase],
      value: reached,
      detail:
        index === 0
          ? `Все связки в работе. Сейчас на этой фазе — ${here}.`
          : `${pluralize(reached, ['Дошла', 'Дошли', 'Дошли'])} до фазы. Сейчас на ней — ${here}.`,
    }
  })
}
