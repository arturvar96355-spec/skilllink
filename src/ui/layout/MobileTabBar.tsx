'use client'

import type { CSSProperties } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Icon } from '../primitives/Icon'
import { isActiveItem, type NavGroup, type NavItem } from './navigation'
import styles from './Shell.module.css'

/**
 * Нижняя панель разделов на телефоне (решение 79, по образцу A24): главные
 * разделы под большим пальцем. Берёт первые пять пунктов меню пользователя —
 * у представителя вуза свои. На широком экране не показывается.
 *
 * Колонки — поровну (решение 205, замечание S6): при колонках по ширине
 * содержимого (решение 140) более длинная подпись была бы заметно шире
 * соседних. В пятую часть 360–430 px длинные названия не помещаются даже
 * минимальным 12 px (`--text-caption-size`, меньше нельзя), поэтому часть
 * подписей сокращена целиком — «Список задач» (решение 212) до «Задачи»,
 * «Личный кабинет» до «Кабинет», — а «Программы» оставлена как есть, но с
 * мягким переносом («Програм-мы»): на самых узких экранах она в две строки,
 * на остальных умещается в одну. Полное название пункта — в `aria-label`,
 * если подпись на экране отличается.
 */
const SHORT: Record<string, string> = {
  'Личный кабинет': 'Кабинет',
  // «Список задач» (решение 212) в пятую часть ширины не помещается — «Задачи».
  'Список задач': 'Задачи',
  Программы: 'Програм\u00ADмы',
}

export function MobileTabBar({ groups }: { groups: NavGroup[] }) {
  const pathname = usePathname()
  const items: NavItem[] = groups.flatMap((group) => group.items).slice(0, 5)
  if (items.length === 0) return null
  return (
    <nav
      className={styles.tabBar}
      aria-label="Основные разделы"
      style={{ '--tab-count': items.length } as CSSProperties}
    >
      {items.map((item) => {
        const active = isActiveItem(item, pathname)
        const shown = SHORT[item.label] ?? item.label
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`${styles.tab} ${active ? styles.tabActive : ''}`}
            aria-current={active ? 'page' : undefined}
            aria-label={shown === item.label ? undefined : item.label}
          >
            <Icon name={item.icon} size={20} />
            <span>{shown}</span>
          </Link>
        )
      })}
    </nav>
  )
}
