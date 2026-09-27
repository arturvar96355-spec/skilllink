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
 * «Советы» было сокращением «Рекомендации» (запрещено словарём — не название
 * сущности, решение 140, п. 8), поэтому слово пишется целиком.
 *
 * Колонки — поровну (решение 205, замечание S6): при колонках по ширине
 * содержимого (решение 140) кнопка «Рекомендации» была заметно шире соседних.
 * В пятую часть 360–430 px длинные подписи одной строкой не помещаются даже
 * минимальным 12 px (`--text-caption-size`, меньше нельзя), поэтому в них
 * поставлены мягкие переносы: «Рекомен-дации» — всегда в две строки,
 * «Програм-мы» — только на самых узких экранах, где не влезает. Полное название
 * пункта — в `aria-label`, если подпись на экране отличается.
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
