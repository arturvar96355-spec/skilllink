'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { SearchEntityType, SearchItemDto, SearchResultDto } from '@/shared/contracts'
import { Icon, type IconName } from '../primitives/Icon'
import { Skeleton } from '../primitives/Skeleton'
import { useResource } from '../hooks/useResource'
import { useDebounced, useEscape } from '../hooks/dom'
import { buildQuery } from '../lib/api'
import { searchItemHref } from '../lib/links'
import styles from './Search.module.css'

const TYPE_ICONS: Record<SearchEntityType, IconName> = {
  university: 'university',
  program: 'program',
  cooperation: 'cooperation',
  product: 'product',
  skill: 'skill',
  document: 'document',
}

/** Меньше двух символов сервер не принимает — и правильно: по одной букве найдётся всё. */
const MIN_QUERY_LENGTH = 2

interface Position {
  x: number
  y: number
}

/**
 * Глобальный поиск.
 *
 * Постоянной строки поиска в шапке нет (раздел 11 дизайн-системы): вместо неё
 * плавающая кнопка и окно, которое можно перетащить мышью. Окно берётся
 * за ручку слева, а не за всю поверхность: иначе выделение текста в строке
 * ввода превращалось бы в перетаскивание.
 */
export function GlobalSearch() {
  const router = useRouter()
  const [isOpen, setIsOpen] = useState(false)
  /**
   * Окно не исчезает мгновенно: сначала проигрывается обратная анимация
   * (раздел 13.3 документа об интерфейсе), и только потом оно снимается
   * с экрана. Иначе закрытие выглядит как сбой, а не как действие.
   */
  const [isClosing, setIsClosing] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [position, setPosition] = useState<Position | null>(null)
  const windowRef = useRef<HTMLDivElement | null>(null)
  const fabRef = useRef<HTMLButtonElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const dragOffset = useRef<Position | null>(null)

  const CLOSE_MS = 180
  const close = useCallback(() => {
    setIsClosing(true)
    window.setTimeout(() => {
      setIsOpen(false)
      setIsClosing(false)
    }, CLOSE_MS)
  }, [])
  useEscape(close, isOpen)

  const toggle = useCallback(() => {
    if (isOpen) close()
    else setIsOpen(true)
  }, [isOpen, close])

  // Ctrl + K — привычное сочетание для поиска; на macOS то же самое с ⌘.
  useEffect(() => {
    function handle(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        toggle()
      }
    }
    document.addEventListener('keydown', handle)
    return () => document.removeEventListener('keydown', handle)
  }, [toggle])

  /*
   * Кнопка перетекает в окно (07, раздел 24): окно стартует с формы и места
   * кнопки — капсулой в углу — и разворачивается в своё положение, а содержимое
   * проявляется, когда форма уже почти готова. Так видно, откуда окно открылось.
   */
  useLayoutEffect(() => {
    if (!isOpen) return
    const node = windowRef.current
    const fab = fabRef.current
    if (!node || !fab || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const from = fab.getBoundingClientRect()
    const to = node.getBoundingClientRect()
    if (to.width === 0 || to.height === 0) return
    const base = node.style.transform || 'none'
    const origin = node.style.transformOrigin
    node.style.transformOrigin = '0 0'
    const morph = node.animate(
      [
        {
          transform: `${base === 'none' ? '' : base} translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width}, ${from.height / to.height})`,
          borderRadius: '999px',
          opacity: 0.6,
        },
        { transform: base, borderRadius: getComputedStyle(node).borderRadius, opacity: 1 },
      ],
      { duration: 460, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
    )
    for (const child of Array.from(node.children)) {
      child.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: 220,
        delay: 200,
        easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
        fill: 'backwards',
      })
    }
    const restore = () => {
      node.style.transformOrigin = origin
    }
    morph.finished.then(restore, restore)
  }, [isOpen])

  useEffect(() => {
    if (isOpen) {
      // Фокус в строке сразу после открытия — иначе придётся щёлкать по ней.
      window.setTimeout(() => inputRef.current?.focus(), 30)
    } else {
      setQuery('')
      setActiveIndex(0)
    }
  }, [isOpen])

  const debouncedQuery = useDebounced(query.trim(), 250)
  const path =
    isOpen && debouncedQuery.length >= MIN_QUERY_LENGTH
      ? `/api/search${buildQuery({ q: debouncedQuery, limit: 5 })}`
      : null
  const search = useResource<SearchResultDto>(path)

  // Плоский список — по нему ходят стрелки, независимо от разбивки на группы.
  const flatItems = useMemo<SearchItemDto[]>(
    () => (search.data?.groups ?? []).flatMap((group) => group.items),
    [search.data],
  )

  useEffect(() => setActiveIndex(0), [debouncedQuery])

  const openItem = useCallback(
    (item: SearchItemDto) => {
      close()
      router.push(searchItemHref(item.type, item.id))
    },
    [close, router],
  )

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (flatItems.length === 0) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((current) => (current + 1) % flatItems.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((current) => (current - 1 + flatItems.length) % flatItems.length)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const item = flatItems[activeIndex]
      if (item) openItem(item)
    }
  }

  /**
   * Перетаскивание за верхнюю строку окна.
   *
   * Строка ввода и кнопки из области захвата исключены: иначе попытка выделить
   * текст мышью превращалась бы в перетаскивание окна (раздел 13.2).
   */
  function startDrag(event: React.PointerEvent<HTMLDivElement>) {
    const node = windowRef.current
    const target = event.target as HTMLElement
    if (!node || target.closest('input, button')) return
    const rect = node.getBoundingClientRect()
    dragOffset.current = { x: event.clientX - rect.left, y: event.clientY - rect.top }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function onDrag(event: React.PointerEvent<HTMLDivElement>) {
    const offset = dragOffset.current
    const node = windowRef.current
    if (!offset || !node) return
    const rect = node.getBoundingClientRect()
    const maxX = window.innerWidth - rect.width - 8
    const maxY = window.innerHeight - rect.height - 8
    setPosition({
      x: Math.min(Math.max(8, event.clientX - offset.x), Math.max(8, maxX)),
      y: Math.min(Math.max(8, event.clientY - offset.y), Math.max(8, maxY)),
    })
  }

  function endDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (dragOffset.current === null) return
    dragOffset.current = null
    event.currentTarget.releasePointerCapture(event.pointerId)
  }

  const hasResults = flatItems.length > 0
  const style = position
    ? { left: position.x, top: position.y }
    : // Положение по умолчанию: вверху по центру, как привычное окно поиска.
      { left: '50%', top: '14vh', transform: 'translateX(-50%)' }

  let itemIndex = -1

  return (
    <>
      <button
        ref={fabRef}
        type="button"
        className={styles.fab}
        onClick={toggle}
        aria-expanded={isOpen}
        aria-label="Поиск по системе"
      >
        <Icon name="search" size={18} />
        <span className={styles.fabLabel}>Поиск</span>
        <span className={styles.hint}>Ctrl K</span>
      </button>

      {isOpen && (
        <div
          ref={windowRef}
          className={[
            styles.window,
            hasResults || search.isLoading ? '' : styles.capsule,
            isClosing ? styles.closing : '',
          ]
            .filter(Boolean)
            .join(' ')}
          style={style}
          role="dialog"
          aria-label="Глобальный поиск"
        >
          <div
            className={styles.inputRow}
            onPointerDown={startDrag}
            onPointerMove={onDrag}
            onPointerUp={endDrag}
          >
            <span className={styles.handle} title="Окно можно перетащить" aria-hidden="true">
              <Icon name="menu" size={16} />
            </span>
            <Icon name="search" size={20} />
            <input
              ref={inputRef}
              className={styles.input}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Поиск вузов, программ, связок..."
              aria-label="Поисковый запрос"
              autoComplete="off"
            />
            <span className={styles.hint}>Esc</span>
          </div>

          {query.trim().length >= MIN_QUERY_LENGTH && (
            <div className={styles.results}>
              {search.isLoading ? (
                <div style={{ padding: 'var(--space-3) var(--space-5)' }}>
                  <Skeleton height="34px" />
                </div>
              ) : search.error ? (
                <p className={styles.state}>{search.error.message}</p>
              ) : !hasResults ? (
                <p className={styles.state}>
                  Ничего не найдено. Попробуйте другой запрос — например, часть названия вуза.
                </p>
              ) : (
                (search.data?.groups ?? []).map((group) => (
                  <div key={group.type}>
                    <div className={styles.groupTitle}>
                      <span>{group.title}</span>
                      {group.total > group.items.length && <span>ещё {group.total - group.items.length}</span>}
                    </div>
                    {group.items.map((item) => {
                      itemIndex += 1
                      const index = itemIndex
                      return (
                        <button
                          key={`${item.type}:${item.id}`}
                          type="button"
                          className={[styles.result, index === activeIndex ? styles.active : '']
                            .filter(Boolean)
                            .join(' ')}
                          onMouseEnter={() => setActiveIndex(index)}
                          onClick={() => openItem(item)}
                        >
                          <span className={styles.resultIcon}>
                            <Icon name={TYPE_ICONS[item.type]} size={16} />
                          </span>
                          <span className={styles.resultText}>
                            <span className={styles.resultTitle}>{item.title}</span>
                            {item.subtitle && (
                              <span className={styles.resultSubtitle}>{item.subtitle}</span>
                            )}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                ))
              )}
            </div>
          )}

          {query.trim().length < MIN_QUERY_LENGTH && (
            <div className={styles.footerHint}>
              <span>↑ ↓ — выбор</span>
              <span>Enter — открыть</span>
              <span>Esc — закрыть</span>
            </div>
          )}
        </div>
      )}
    </>
  )
}
