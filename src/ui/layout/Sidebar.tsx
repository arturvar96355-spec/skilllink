'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Icon } from '../primitives/Icon'
import { Logo } from './Logo'
import { isActiveItem, type NavGroup } from './navigation'
import styles from './Sidebar.module.css'

export interface SidebarProps {
  groups: NavGroup[]
  /** Открыто ли меню на узком экране. */
  isOpen: boolean
  onClose: () => void
}

/**
 * Боковое меню.
 *
 * Группы раскрываются и сворачиваются, но группа с текущей страницей
 * раскрывается сама и остаётся раскрытой (раздел 5 шаблона страниц):
 * пользователь не должен искать, где он находится.
 */
export function Sidebar({ groups, isOpen, onClose }: SidebarProps) {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  // Переход на другую страницу закрывает меню на узком экране.
  useEffect(() => {
    onClose()
    // onClose меняется вместе с родителем; следим только за адресом.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname])

  return (
    <>
      <div
        className={isOpen ? styles.scrimVisible : styles.scrim}
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        className={[styles.sidebar, isOpen ? styles.open : ''].filter(Boolean).join(' ')}
        aria-label="Разделы системы"
      >
        <Link href="/" className={styles.brand}>
          <Logo />
          <span className={styles.brandText}>
            <span className={styles.brandName}>SkillLink</span>
            <span className={styles.brandSub}>Вузы × IT-компании</span>
          </span>
        </Link>

        <nav className={styles.nav}>
          {groups.map((group) => {
            const hasActive = group.items.some((item) => isActiveItem(item, pathname))
            // Группа с текущей страницей раскрыта всегда, свернуть её нельзя.
            const isOpenGroup = hasActive || !collapsed[group.key]

            return (
              <div key={group.key} className={styles.group}>
                <button
                  type="button"
                  className={styles.groupHead}
                  aria-expanded={isOpenGroup}
                  onClick={() =>
                    setCollapsed((current) => ({ ...current, [group.key]: !current[group.key] }))
                  }
                >
                  {group.title}
                  <Icon
                    name="chevronDown"
                    size={16}
                    className={[styles.chevron, isOpenGroup ? styles.chevronOpen : styles.chevronClosed].join(' ')}
                  />
                </button>

                <div
                  className={[styles.items, isOpenGroup ? '' : styles.itemsClosed]
                    .filter(Boolean)
                    .join(' ')}
                >
                  <div className={styles.itemsInner}>
                    {group.items.map((item) => {
                      const active = isActiveItem(item, pathname)
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          className={[styles.item, active ? styles.itemActive : '']
                            .filter(Boolean)
                            .join(' ')}
                          aria-current={active ? 'page' : undefined}
                          tabIndex={isOpenGroup ? undefined : -1}
                        >
                          <Icon name={item.icon} size={18} className={styles.itemIcon} />
                          <span className={styles.itemLabel}>{item.label}</span>
                        </Link>
                      )
                    })}
                  </div>
                </div>
              </div>
            )
          })}
        </nav>

        <div className={styles.footer}>
          <span className={styles.hint}>Поиск по системе — кнопка справа внизу или Ctrl + K</span>
        </div>
      </aside>
    </>
  )
}
