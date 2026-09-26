'use client'

import { useRef, useState } from 'react'
import type { IssuedCalendarFeedDto } from '@/shared/contracts'
import { Button, Icon, Modal, useToast } from '@/ui'
import styles from './profile.module.css'

/**
 * Ссылка на подписку календаря (.ics) показывается один раз (решение 105,
 * `docs/API_CONTRACT.md`, «Подписка на календарь») — в базе только хеш токена,
 * второй раз сервер её не отдаст, только перевыпустит другую. Окно не закрывается
 * щелчком мимо — тот же приём, что у одноразового пароля (`UserModals.tsx`,
 * `PasswordIssuedModal`): случайный щелчок стоил бы новой, уже другой ссылки.
 */
export function CalendarFeedModal({ issued, onClose }: { issued: IssuedCalendarFeedDto; onClose: () => void }) {
  const toast = useToast()
  const urlRef = useRef<HTMLSpanElement>(null)
  const [copiedField, setCopiedField] = useState<'url' | 'webcal' | null>(null)

  async function copy(value: string, field: 'url' | 'webcal', node: HTMLSpanElement | null) {
    try {
      await navigator.clipboard.writeText(value)
      setCopiedField(field)
      toast.success('Ссылка скопирована')
    } catch {
      // Буфер обмена недоступен (не HTTPS, запрет браузера) — выделяем ссылку,
      // чтобы скопировать её сочетанием клавиш.
      if (node) window.getSelection()?.selectAllChildren(node)
      toast.info('Скопировать не удалось — ссылка выделена, нажмите Ctrl+C или ⌘C')
    }
  }

  return (
    <Modal
      isOpen
      onClose={onClose}
      closeOnBackdrop={false}
      title={issued.replaced ? 'Новая ссылка на календарь' : 'Календарь подключён'}
      description="Ссылка показывается один раз. Больше мы её не покажем — только выпустим новую, а эта перестанет работать."
      footer={
        <Button variant="primary" onClick={onClose}>
          Готово
        </Button>
      }
    >
      <div className={styles.calendarField}>
        <span className={styles.calendarFieldLabel}>Для Google и Яндекс Календаря — «Подписаться по URL»</span>
        <div className={styles.calendarValue}>
          <span ref={urlRef} className={styles.calendarValueText} aria-label="Ссылка на календарь">
            {issued.url}
          </span>
          <Button
            variant="secondary"
            size="sm"
            icon={copiedField === 'url' ? 'check' : undefined}
            onClick={() => void copy(issued.url, 'url', urlRef.current)}
          >
            {copiedField === 'url' ? 'Скопировано' : 'Скопировать'}
          </Button>
        </div>
      </div>

      <div className={styles.calendarField}>
        <span className={styles.calendarFieldLabel}>Для Apple Календаря и Outlook</span>
        <div className={styles.calendarValue}>
          <span className={styles.calendarValueText}>{issued.webcalUrl}</span>
          <Button
            variant="secondary"
            size="sm"
            icon={copiedField === 'webcal' ? 'check' : undefined}
            onClick={() => void copy(issued.webcalUrl, 'webcal', null)}
          >
            {copiedField === 'webcal' ? 'Скопировано' : 'Скопировать'}
          </Button>
        </div>
      </div>

      <div className={styles.warning}>
        <Icon name="alert" size={16} />
        <p>
          Ссылка = доступ: кто её узнает, увидит сроки этапов и встречи без входа в систему. Не пересылайте
          её в общих чатах.
        </p>
      </div>
    </Modal>
  )
}
