import type { TeamLoadDto, TeamLoadRuleDto } from '@/shared/contracts'
import { Badge, type BadgeTone } from '@/ui'
import { cooperationsText, levelLabel, loadFormula, loadSegments, meetingsText, overdueText, scalePosition } from './team-view'
import styles from './team.module.css'

/**
 * Полоса нагрузки (решение 203): связки — сплошной фиолетовый, встречи — тот же тон
 * светлее, просрочки — штриховкой сигнального цвета (он на экране — только у просрочки).
 * Две риски — пороги «норма» и «перегрузка» из `loadRule`, а не своя копия чисел.
 */
export function LoadBar({ load, rule, size = 'sm' }: { load: TeamLoadDto; rule: TeamLoadRuleDto; size?: 'sm' | 'lg' }) {
  const parts = loadSegments(load, rule)
  return (
    <div className={[styles.bar, size === 'lg' ? styles.barLg : ''].filter(Boolean).join(' ')} role="img" aria-label={`Нагрузка ${loadFormula(load, rule)}`}>
      <span className={styles.barCoops} style={{ width: `${parts.cooperations}%` }} />
      <span className={styles.barMeetings} style={{ width: `${parts.meetings}%` }} />
      <span className={styles.barOverdue} style={{ width: `${parts.overdue}%` }} />
      <span className={styles.barTick} style={{ left: `${scalePosition(rule.normMax, rule)}%` }} />
      <span className={styles.barTick} style={{ left: `${scalePosition(rule.highMax, rule)}%` }} />
    </div>
  )
}

/**
 * Метка уровня — в одной фиолетовой гамме (правка владельца к макету): норма —
 * нейтральная, высокая — светлый фиолетовый, перегружен — насыщенный фиолетовый.
 * Красный здесь не используется: он оставлен просрочке.
 */
const LEVEL_TONE: Record<TeamLoadDto['level'], BadgeTone> = {
  NORMAL: 'neutral',
  HIGH: 'info',
  OVERLOADED: 'accent',
}

export function LoadBadge({ level }: { level: TeamLoadDto['level'] }) {
  return (
    <span className={styles.levelBadge} data-level={level}>
      <Badge tone={LEVEL_TONE[level]} withDot>
        {levelLabel(level)}
      </Badge>
    </span>
  )
}

/** Подпись под полосой в панели: из чего сложились баллы. */
export function LoadLegend({ load, rule }: { load: TeamLoadDto; rule: TeamLoadRuleDto }) {
  return (
    <ul className={styles.legend}>
      <li>
        <i className={[styles.key, styles.keyCoops].join(' ')} aria-hidden="true" />
        {cooperationsText(load.cooperations)}
      </li>
      <li>
        <i className={[styles.key, styles.keyMeetings].join(' ')} aria-hidden="true" />
        {meetingsText(load.meetings)} за неделю
      </li>
      <li>
        <i className={[styles.key, styles.keyOverdue].join(' ')} aria-hidden="true" />
        {overdueText(load.overdue)} × {rule.overdueWeight}
      </li>
    </ul>
  )
}
