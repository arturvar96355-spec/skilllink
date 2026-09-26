'use client'

import Link from 'next/link'
import type { PulseDto } from '@/shared/contracts'
import { EmptyState, ErrorState, Skeleton, useResource } from '@/ui'
import profileStyles from './profile.module.css'
import styles from './ProfileSignals.module.css'

/**
 * «Пульс» (решение 120) на вебе — то же самое, что сводка в Telegram-боте:
 * четыре раздела в одном порядке, не больше 10 записей в каждом.
 */
export function ProfilePulse() {
  const pulse = useResource<PulseDto>('/api/me/pulse')
  const data = pulse.data

  return (
    <section className={profileStyles.block} aria-labelledby="profile-pulse">
      <div className={profileStyles.blockHead}>
        <h2 id="profile-pulse" className={profileStyles.blockTitle}>
          Пульс
        </h2>
        {data && <span className={profileStyles.blockNote}>Проверено правил: {data.checkedRules}</span>}
      </div>

      {pulse.isLoading ? (
        <Skeleton width="100%" height="120px" />
      ) : pulse.error ? (
        <ErrorState error={pulse.error} onRetry={pulse.reload} />
      ) : !data ? null : data.isCalm ? (
        <EmptyState icon="check" title="Всё спокойно" description={data.calmText ?? `Проверено правил: ${data.checkedRules}`} />
      ) : (
        <div className={styles.sections}>
          {data.sections
            .filter((section) => section.items.length > 0)
            .map((section) => (
              <div key={section.key} className={styles.section}>
                <div className={styles.sectionHead}>
                  <h3 className={styles.sectionTitle}>{section.title}</h3>
                  <span className={styles.sectionCount}>{section.total}</span>
                </div>
                <ul className={styles.items}>
                  {section.items.map((item, index) => {
                    const text = (
                      <span>
                        <span className={styles.pulseGroup}>{item.group}: </span>
                        {item.text}
                      </span>
                    )
                    return (
                      <li key={`${section.key}-${index}`} className={styles.pulseItem}>
                        <span className={[styles.dot, styles[item.severity] ?? ''].join(' ')} aria-hidden="true" />
                        {item.href ? (
                          <Link className={styles.itemLink} href={item.href}>
                            {text}
                          </Link>
                        ) : (
                          text
                        )}
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}
        </div>
      )}
    </section>
  )
}
