'use client'

import { Button } from '../primitives/Button'
import { useUiMode } from '../hooks/ui-mode'
import { UI_MODE_LABELS, type UiMode } from '../lib/ui-mode'
import styles from './Shell.module.css'

const MODES: UiMode[] = ['work', 'showcase']

const HINTS: Record<UiMode, string> = {
  work: 'Реестры списком, на главной сразу то, что требует внимания, без лишнего движения',
  showcase: 'Весь визуал для показа: бирки, кольца, карта, заставка, анимация',
}

/**
 * Переключатель режима интерфейса (решение 80) — пара кнопок, как «Бирки / Список»
 * в реестрах. В шапке — тихий (выбранная кнопка обычная, другая прозрачная)
 * и только на широком экране; на странице настроек — как переключатели реестров.
 */
export function UiModeSwitch({ placement = 'page' }: { placement?: 'header' | 'page' }) {
  const { mode, setMode } = useUiMode()
  const inHeader = placement === 'header'

  return (
    <div
      className={inHeader ? `${styles.modeSwitch} ${styles.modeSwitchHeader}` : styles.modeSwitch}
      role="group"
      aria-label="Режим интерфейса"
    >
      {MODES.map((value) => {
        const active = value === mode
        return (
          <Button
            key={value}
            size="sm"
            variant={active ? (inHeader ? 'secondary' : 'primary') : inHeader ? 'ghost' : 'secondary'}
            aria-pressed={active}
            title={HINTS[value]}
            onClick={() => setMode(value)}
          >
            {UI_MODE_LABELS[value]}
          </Button>
        )
      })}
    </div>
  )
}
