'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, useAnimate, usePresence } from 'motion/react'
import type { UniversityListItemDto } from '@/shared/contracts'
import { Button, IconButton, useEscape, universityHref } from '@/ui'
import { useFocusTrap } from '@/ui/hooks/focus-trap'
import { UniversityGraph } from './UniversityGraph'
import { UniversityFacts } from './UniversityFacts'
import styles from './UniversityGraphSheet.module.css'

/**
 * Граф связей вуза поверх реестра (решение 79): щелчок по центральной бирке.
 *
 * Панель вырастает из бирки (clip-path от её границ), слева — факты вуза,
 * справа — граф. Esc, «Закрыть» или щелчок по фону — панель сворачивается
 * обратно в бирку. Полная страница вуза — кнопкой.
 */

export interface GraphOrigin {
  row: UniversityListItemDto
  card: HTMLElement
}

const EASE_OPEN = [0.16, 1, 0.3, 1] as const
const EASE_CLOSE = [0.65, 0, 0.35, 1] as const

function clipFrom(rect: DOMRect): string {
  const right = window.innerWidth - rect.right
  const bottom = window.innerHeight - rect.bottom
  return `inset(${rect.top}px ${right}px ${bottom}px ${rect.left}px round 14px)`
}

const CLIP_FULL = 'inset(0px 0px 0px 0px round 0px)'

export function UniversityGraphSheet({
  origin,
  onClose,
  canSeeAnalytics,
}: {
  origin: GraphOrigin | null
  onClose: () => void
  canSeeAnalytics: boolean
}) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  if (!mounted) return null
  return createPortal(
    <AnimatePresence>
      {origin && <Sheet key={origin.row.id} origin={origin} onClose={onClose} canSeeAnalytics={canSeeAnalytics} />}
    </AnimatePresence>,
    document.body,
  )
}

function Sheet({
  origin,
  onClose,
  canSeeAnalytics,
}: {
  origin: GraphOrigin
  onClose: () => void
  canSeeAnalytics: boolean
}) {
  const { row } = origin
  const [scope, animate] = useAnimate<HTMLDivElement>()
  const [isPresent, safeToRemove] = usePresence()
  const dialogRef = useRef<HTMLDivElement>(null)
  useEscape(onClose, isPresent)
  useFocusTrap(dialogRef, isPresent, 'container')

  const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

  // Страница под панелью не прокручивается; фокус потом возвращается к бирке.
  useEffect(() => {
    const previous = document.body.style.overflow
    const focus = document.activeElement as HTMLElement | null
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
      focus?.focus({ preventScroll: true })
    }
  }, [])

  useLayoutEffect(() => {
    const panel = scope.current.querySelector<HTMLElement>('[data-panel]')!
    const backdrop = scope.current.querySelector<HTMLElement>('[data-backdrop]')!
    if (reduced()) {
      animate(scope.current, { opacity: [0, 1] }, { duration: 0.2 })
      return
    }
    animate(backdrop, { opacity: [0, 1] }, { duration: 0.4 })
    animate(
      panel,
      { clipPath: [clipFrom(origin.card.getBoundingClientRect()), CLIP_FULL] },
      { duration: 0.7, ease: EASE_OPEN },
    )
    animate('[data-reveal]', { opacity: [0, 1], y: [14, 0] }, { duration: 0.45, delay: 0.25, ease: EASE_OPEN })
    // Один раз при появлении.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (isPresent) return
    if (reduced()) {
      animate(scope.current, { opacity: 0 }, { duration: 0.15 }).then(safeToRemove)
      return
    }
    const panel = scope.current.querySelector<HTMLElement>('[data-panel]')!
    const backdrop = scope.current.querySelector<HTMLElement>('[data-backdrop]')!
    animate('[data-reveal]', { opacity: 0 }, { duration: 0.15 })
    animate(backdrop, { opacity: 0 }, { duration: 0.45, ease: EASE_CLOSE })
    animate(
      panel,
      { clipPath: [CLIP_FULL, clipFrom(origin.card.getBoundingClientRect())] },
      { duration: 0.5, ease: EASE_CLOSE },
    ).then(safeToRemove)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPresent])

  const titleId = `graph-${row.id}`

  return (
    <div ref={scope} className={styles.root}>
      <div className={styles.backdrop} data-backdrop aria-hidden onClick={onClose} />
      <div
        ref={dialogRef}
        className={styles.panel}
        data-panel
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className={styles.bar} data-reveal>
          <span className={styles.kicker} id={titleId}>
            Связи вуза · {row.shortName ?? row.name}
          </span>
          <div className={styles.actions}>
            <Button variant="primary" href={universityHref(row.id)} icon="arrowRight" iconPosition="right">
              Открыть карточку вуза
            </Button>
            <IconButton icon="close" label="Закрыть" onClick={onClose} />
          </div>
        </div>
        <div className={styles.body}>
          <div className={styles.facts} data-reveal>
            <UniversityFacts row={row} canSeeAnalytics={canSeeAnalytics} />
          </div>
          <div className={styles.graph} data-reveal>
            <UniversityGraph
              universityId={row.id}
              universityName={row.name}
              universityCode={row.shortName ?? row.name}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
