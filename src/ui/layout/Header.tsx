'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { signOut } from 'next-auth/react'
import { useState } from 'react'
import { LayoutGroup, motion } from 'motion/react'
import { USER_ROLE_LABELS } from '@/shared/contracts'
import { Avatar } from '../primitives/Avatar'
import { Icon } from '../primitives/Icon'
import { IconButton } from '../primitives/IconButton'
import { NotificationBell } from '../notifications/NotificationBell'
import { openSearch } from '../search/search-events'
import { useEscape, useOutsideClick } from '../hooks/dom'
import { useCurrentUser } from './CurrentUser'
import { isActiveItem, type NavGroup, type NavItem } from './navigation'
import { ROUTES } from '../lib/links'
import { Logo } from './Logo'
import { ThemeToggle } from './ThemeToggle'
import { UiModeSwitch } from './UiModeSwitch'
import styles from './Shell.module.css'

/**
 * Шапка приложения (решение 122, бриф v2 — 1.5): логотип → разделы → поиск →
 * тема → уведомления → профиль. Компактная, полупрозрачная, с тонкой границей;
 * боковое меню на широком экране больше не нужно — разделы здесь. Под активным
 * разделом подложка переезжает плавно (общий layoutId).
 *
 * Шесть главных разделов — на виду, остальные — в «Ещё». На узком экране
 * (до 1080 px) разделы уходят в выезжающее меню, на телефоне — нижняя панель.
 */

/** Сколько разделов на виду; остальные — в «Ещё». */
const PRIMARY_LIMIT = 6

function split(groups: NavGroup[]): { primary: NavItem[]; more: NavItem[] } {
  const all = groups.flatMap((group) => group.items)
  // Аналитика — в главном ряду рядом с рабочими разделами (бриф v2, 1.5).
  const analytics = all.find((item) => item.href === ROUTES.analytics)
  const work = groups[0]?.items ?? []
  const primary = [...work, ...(analytics && !work.includes(analytics) ? [analytics] : [])].slice(0, PRIMARY_LIMIT)
  return { primary, more: all.filter((item) => !primary.includes(item)) }
}

export function Header({ groups, onMenuClick }: { groups: NavGroup[]; onMenuClick: () => void }) {
  const pathname = usePathname()
  const { primary, more } = split(groups)
  const moreActive = more.some((item) => isActiveItem(item, pathname))

  return (
    <header className={styles.header} data-nav-chrome="header">
      <IconButton icon="menu" label="Открыть меню" className={styles.menuButton} onClick={onMenuClick} />

      <Link href={ROUTES.dashboard} className={styles.home} aria-label="SkillLink — на главную">
        <Logo size={24} interactive />
        <span className={styles.homeName}>SkillLink</span>
      </Link>

      <LayoutGroup id="top-nav">
        <nav className={styles.topNav} aria-label="Разделы">
          {primary.map((item) => {
            const active = isActiveItem(item, pathname)
            return (
              <Link
                key={item.href}
                href={item.href}
                className={[styles.topItem, active ? styles.topItemActive : ''].filter(Boolean).join(' ')}
                aria-current={active ? 'page' : undefined}
              >
                {active && (
                  <motion.span
                    layoutId="top-nav-pill"
                    className={styles.topPill}
                    transition={{ type: 'spring', stiffness: 420, damping: 36 }}
                  />
                )}
                <span className={styles.topLabel}>{item.label}</span>
              </Link>
            )
          })}
          {more.length > 0 && <MoreMenu items={more} active={moreActive} pathname={pathname} />}
        </nav>
      </LayoutGroup>

      <span className={styles.spacer} />

      <div className={styles.headerRight}>
        <button
          type="button"
          className={styles.searchPill}
          data-search-trigger
          onClick={(event) => openSearch(event.currentTarget)}
        >
          <Icon name="search" size={16} />
          <span className={styles.searchLabel}>Поиск</span>
          <kbd className={styles.kbd}>⌘K</kbd>
        </button>
        <ThemeToggle />
        <NotificationBell />
        <ProfileMenu />
      </div>
    </header>
  )
}

/** «Ещё»: разделы, которым не хватило места в ряду. */
function MoreMenu({ items, active, pathname }: { items: NavItem[]; active: boolean; pathname: string }) {
  const [isOpen, setIsOpen] = useState(false)
  const ref = useOutsideClick<HTMLDivElement>(() => setIsOpen(false), isOpen)
  useEscape(() => setIsOpen(false), isOpen)

  return (
    <div ref={ref} className={styles.moreWrap}>
      <button
        type="button"
        className={[styles.topItem, active ? styles.topItemActive : ''].filter(Boolean).join(' ')}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        onClick={() => setIsOpen((open) => !open)}
      >
        {active && <motion.span layoutId="top-nav-pill" className={styles.topPill} />}
        <span className={styles.topLabel}>
          Ещё
          <Icon name="chevronDown" size={16} className={isOpen ? styles.chevronOpen : styles.chevron} />
        </span>
      </button>
      {isOpen && (
        <div className={styles.dropdown} role="menu">
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              role="menuitem"
              className={[styles.dropdownItem, isActiveItem(item, pathname) ? styles.dropdownActive : '']
                .filter(Boolean)
                .join(' ')}
              onClick={() => setIsOpen(false)}
            >
              <Icon name={item.icon} size={16} />
              {item.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

/** Профиль: аватар, по нажатию — меню: кабинет, режим интерфейса, выход. */
function ProfileMenu() {
  const user = useCurrentUser()
  const [isOpen, setIsOpen] = useState(false)
  const [isLeaving, setIsLeaving] = useState(false)
  const ref = useOutsideClick<HTMLDivElement>(() => setIsOpen(false), isOpen)
  useEscape(() => setIsOpen(false), isOpen)

  return (
    <div ref={ref} className={styles.moreWrap}>
      <button
        type="button"
        className={styles.profile}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-label={`Профиль: ${user.fullName}`}
        onClick={() => setIsOpen((open) => !open)}
      >
        <Avatar name={user.fullName} />
      </button>
      {isOpen && (
        <div className={[styles.dropdown, styles.dropdownRight].join(' ')} role="menu">
          <div className={styles.dropdownHead}>
            <span className={styles.profileName}>{user.fullName}</span>
            <span className={styles.profileRole}>{user.position ?? USER_ROLE_LABELS[user.role]}</span>
          </div>
          <Link href={ROUTES.profile} role="menuitem" className={styles.dropdownItem} onClick={() => setIsOpen(false)}>
            <Icon name="user" size={16} />
            Личный кабинет
          </Link>
          <Link href={ROUTES.myData} role="menuitem" className={styles.dropdownItem} onClick={() => setIsOpen(false)}>
            <Icon name="lock" size={16} />
            Мои данные
          </Link>
          <div className={styles.dropdownMode}>
            <span className={styles.dropdownLabel}>Режим интерфейса</span>
            <UiModeSwitch placement="header" />
          </div>
          <button
            type="button"
            role="menuitem"
            className={[styles.dropdownItem, styles.dropdownDanger].join(' ')}
            disabled={isLeaving}
            onClick={async () => {
              setIsLeaving(true)
              await signOut({ redirectTo: '/login' })
            }}
          >
            <Icon name="logout" size={16} />
            {isLeaving ? 'Выходим…' : 'Выйти'}
          </button>
        </div>
      )}
    </div>
  )
}
