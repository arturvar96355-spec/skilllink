'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Icon } from '../primitives/Icon'
import { isActiveItem, type NavGroup, type NavItem } from './navigation'
import styles from './Shell.module.css'

/**
 * Нижняя панель разделов на телефоне (решение 79, по образцу A24): главные
 * разделы под большим пальцем. Берёт первые пять пунктов меню пользователя —
 * у представителя вуза свои. На широком экране не показывается.
 */
const SHORT: Record<string, string> = {
  Университеты: 'Вузы',
  Сотрудничество: 'Связки',
  Рекомендации: 'Советы',
  'Личный кабинет': 'Кабинет',
}

export function MobileTabBar({ groups }: { groups: NavGroup[] }) {
  const pathname = usePathname()
  const items: NavItem[] = groups.flatMap((group) => group.items).slice(0, 5)
  if (items.length === 0) return null
  return (
    <nav className={styles.tabBar} aria-label="Основные разделы">
      {items.map((item) => {
        const active = isActiveItem(item, pathname)
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`${styles.tab} ${active ? styles.tabActive : ''}`}
            aria-current={active ? 'page' : undefined}
          >
            <Icon name={item.icon} size={20} />
            <span>{SHORT[item.label] ?? item.label}</span>
          </Link>
        )
      })}
    </nav>
  )
}
