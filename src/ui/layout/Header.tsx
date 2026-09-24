'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { USER_ROLE_LABELS } from '@/shared/contracts'
import { Avatar } from '../primitives/Avatar'
import { Icon } from '../primitives/Icon'
import { IconButton } from '../primitives/IconButton'
import { NotificationBell } from '../notifications/NotificationBell'
import { useCurrentUser } from './CurrentUser'
import { currentSectionTitle, type NavGroup } from './navigation'
import { ROUTES } from '../lib/links'
import { Logo } from './Logo'
import { UiModeSwitch } from './UiModeSwitch'
import styles from './Shell.module.css'

/**
 * Верхняя панель.
 *
 * Постоянной строки поиска здесь нет — она заменена плавающей кнопкой
 * (раздел 7 шаблона страниц). Слева кнопка с логотипом: она всегда ведёт
 * на главную, справа — режим интерфейса (решение 80), уведомления и переход
 * в личный кабинет.
 */
export function Header({ groups, onMenuClick }: { groups: NavGroup[]; onMenuClick: () => void }) {
  const user = useCurrentUser()
  const pathname = usePathname()
  // Личного кабинета нет в меню — открывается по имени в шапке, — но назван он должен быть
  // как любой раздел: без этого в шапке стояло одно «SkillLink».
  const section =
    currentSectionTitle(groups, pathname) ??
    (pathname.startsWith(ROUTES.profile) ? 'Личный кабинет' : null)

  return (
    <header className={styles.header} data-nav-chrome="header">
      <IconButton
        icon="menu"
        label="Открыть меню"
        className={styles.menuButton}
        onClick={onMenuClick}
      />

      <Link href={ROUTES.dashboard} className={styles.home}>
        <Logo size={24} />
        <span className={styles.homeName}>SkillLink</span>
      </Link>

      {section && (
        <span className={styles.context}>
          <span className={styles.contextSeparator} aria-hidden="true">
            /
          </span>
          {section}
        </span>
      )}

      <span className={styles.spacer} />

      <div className={styles.headerRight}>
        <UiModeSwitch placement="header" />
        <NotificationBell />
        <Link href={ROUTES.profile} className={styles.profile} aria-label="Личный кабинет">
          <Avatar name={user.fullName} />
          <span className={styles.profileText}>
            <span className={styles.profileName}>{user.fullName}</span>
            <span className={styles.profileRole}>
              {user.position ?? USER_ROLE_LABELS[user.role]}
            </span>
          </span>
          <Icon name="chevronRight" size={16} aria-hidden="true" />
        </Link>
      </div>
    </header>
  )
}
