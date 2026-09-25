'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState, type CSSProperties } from 'react'
import { Icon } from '../primitives/Icon'
import { useEscape } from '../hooks/dom'
import { Logo } from './Logo'
import { isActiveItem, type NavGroup } from './navigation'
import { NavPreview, hasPreview } from './NavPreview'
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
  /**
   * Группа под курсором раскрывается сама (раздел 5 шаблона страниц).
   * Наведение не заменяет щелчок, а дополняет его: с клавиатуры и на сенсорном
   * экране наведения нет вовсе, и тогда работает обычное раскрытие по щелчку.
   */
  const [hoveredGroup, setHoveredGroup] = useState<string | null>(null)
  /**
   * Группа, свёрнутая щелчком прямо сейчас.
   *
   * Без этого щелчок выглядел бы сломанным: курсор остаётся на заголовке,
   * наведение тут же раскрывает группу обратно, и человек жмёт снова и снова.
   * Запрет снимается, когда указатель уходит с группы.
   */
  const [closedByClick, setClosedByClick] = useState<string | null>(null)
  /** Мини-сводка раздела у пункта под курсором (решение 79); только с мышью. */
  const [preview, setPreview] = useState<{ href: string; anchor: DOMRect } | null>(null)

  // Открытое на узком экране меню закрывается по Escape, как любое всплывающее окно.
  useEscape(onClose, isOpen)

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
        data-nav-chrome="sidebar"
      >
        <Link href="/" className={styles.brand}>
          <Logo />
          <span className={styles.brandText}>
            <span className={styles.brandName}>SkillLink</span>
            <span className={styles.brandSub}>Вузы × IT-компании</span>
          </span>
        </Link>

        <nav className={styles.nav}>
          {groups.map((group, groupIndex) => {
            const hasActive = group.items.some((item) => isActiveItem(item, pathname))
            // Группа с текущей страницей раскрыта всегда, свернуть её нельзя.
            const isOpenGroup =
              hasActive ||
              !collapsed[group.key] ||
              (hoveredGroup === group.key && closedByClick !== group.key)

            return (
              <div
                key={group.key}
                className={styles.group}
                data-tone={groupIndex % 3}
                onMouseEnter={() => setHoveredGroup(group.key)}
                onMouseLeave={() => {
                  setHoveredGroup((current) => (current === group.key ? null : current))
                  setClosedByClick((current) => (current === group.key ? null : current))
                }}
                // Фокус с клавиатуры раскрывает группу так же, как наведение мышью.
                onFocus={() => setHoveredGroup(group.key)}
                onBlur={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                    setHoveredGroup((current) => (current === group.key ? null : current))
                  }
                }}
              >
                <button
                  type="button"
                  className={styles.groupHead}
                  aria-expanded={isOpenGroup}
                  onClick={() =>
                    setCollapsed((current) => {
                      const willCollapse = !current[group.key]
                      setClosedByClick(willCollapse ? group.key : null)
                      return { ...current, [group.key]: willCollapse }
                    })
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
                          onPointerEnter={(event) => {
                            if (event.pointerType !== 'mouse' || !hasPreview(item.href)) return
                            setPreview({ href: item.href, anchor: event.currentTarget.getBoundingClientRect() })
                          }}
                          onPointerLeave={() => setPreview(null)}
                          onClick={() => setPreview(null)}
                        >
                          <Icon name={item.icon} size={18} className={styles.itemIcon} />
                          <RollText text={item.label} />
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
          {/* Место под кнопку поиска: она стоит здесь, поверх низа меню (search/GlobalSearch). */}
          <span className={styles.searchSlot} aria-hidden="true" />
        </div>
        {preview && <NavPreview href={preview.href} anchor={preview.anchor} />}
      </aside>
    </>
  )
}

/**
 * Подпись пункта меню, буквы которой перекатываются при наведении (решение 79,
 * по образцу кнопок Altitude 101): каждая буква уезжает вверх, снизу приходит
 * её копия, с задержкой по порядку. Читалкам — обычный текст.
 */
function RollText({ text }: { text: string }) {
  return (
    <span className={styles.itemLabel}>
      {/* Имя ссылки для читалок: буквы ниже скрыты от них, иначе слово читалось бы по буквам. */}
      <span className={styles.srOnly}>{text}</span>
      {Array.from(text).map((char, index) => (
        <span
          key={index}
          className={styles.rollChar}
          data-char={char === ' ' ? '\u00a0' : char}
          style={{ '--i': index } as CSSProperties}
          aria-hidden
        >
          {char === ' ' ? '\u00a0' : char}
        </span>
      ))}
    </span>
  )
}
