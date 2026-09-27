'use client'

import { useCallback, useEffect, useId, useMemo, useRef, useState, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '@/ui/primitives/Icon'
import { useEscape, useMediaQuery, useOutsideClick, usePrefersReducedMotion } from '@/ui/hooks/dom'
import {
  DOCS_SEARCH_SUGGESTIONS,
  findRanges,
  isSearchable,
  queryTerms,
  searchDocs,
  type DocsIndexEntry,
  type DocsSearchHit,
} from './docs-search'
import styles from './docs.module.css'

export interface DocsTocGroup {
  id: string
  title: string
  sections: ReadonlyArray<{ id: string; title: string }>
}

/** Имя подсветки для CSS Custom Highlight API (`::highlight(docs-search)` в стилях). */
const HIGHLIGHT = 'docs-search'
/** После какой прокрутки показывается «Наверх». */
const TO_TOP_AFTER = 900

type HighlightRegistry = { set(name: string, value: unknown): void; delete(name: string): void }
type HighlightCtor = new (...ranges: Range[]) => unknown

function highlightApi(): { registry: HighlightRegistry; Highlight: HighlightCtor } | null {
  const css = (globalThis as { CSS?: { highlights?: HighlightRegistry } }).CSS
  const Highlight = (globalThis as { Highlight?: HighlightCtor }).Highlight
  return css?.highlights && Highlight ? { registry: css.highlights, Highlight } : null
}

function sectionNodes(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('#docs-article [data-doc-section]'))
}

/**
 * Текстовые узлы раздела, которые человек читает: без заголовка (он ищется
 * отдельно), без служебного — знака «#», подписей «да»/«нет» в таблице прав
 * (`data-doc-skip`). Узлы склеиваются через пробел: соседние блоки не слипаются
 * в одно слово, как было бы с `textContent`.
 */
function readableTextNodes(root: HTMLElement, withTitle: boolean): Text[] {
  const nodes: Text[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      const parent = node.parentElement
      if (!parent || parent.closest('[data-doc-skip]')) return NodeFilter.FILTER_REJECT
      if (!withTitle && parent.closest('[data-doc-title]')) return NodeFilter.FILTER_REJECT
      return (node as Text).data.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
    },
  })
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) nodes.push(node)
  return nodes
}

/**
 * Оглавление, поиск и «Наверх» документации (решение 214).
 *
 * Текст разделов приходит серверной разметкой (`DocsArticle`); отсюда он
 * читается один раз по `data-doc-*` — реестр в браузер не грузится повторно.
 * Поиск мгновенный: по заголовкам и тексту, без учёта регистра и «ё».
 * Найденное подсвечивается прямо в тексте (CSS Custom Highlight API — без
 * вмешательства в разметку; где его нет, раздел всё равно найден и открыт),
 * ненайденные разделы прячутся, закрытые «Частые вопросы» с совпадением
 * раскрываются.
 *
 * Оглавление слева — маршрут чтения: засечки разделов на одной линии, как
 * этапы связки на ленте; пройденные светлее, текущий отмечен. На узком экране
 * оглавление — выпадающее под кнопкой «Оглавление», поиск — рядом с ней.
 */
export function DocsNav({ toc, variant }: { toc: readonly DocsTocGroup[]; variant: 'public' | 'app' }) {
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState<DocsIndexEntry[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [panelOpen, setPanelOpen] = useState(false)
  const [statusSlot, setStatusSlot] = useState<HTMLElement | null>(null)
  const [showToTop, setShowToTop] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const openedDetails = useRef<HTMLDetailsElement[]>([])
  const reducedMotion = usePrefersReducedMotion()
  // На узком экране поле делит строку с «Оглавлением» — подсказка короче, чтобы не обрезалась.
  const narrow = useMediaQuery('(max-width: 1023px)')
  // Выпадающее оглавление на узком экране закрывается Esc и нажатием мимо.
  const closePanel = useCallback(() => setPanelOpen(false), [])
  const navRef = useOutsideClick<HTMLElement>(closePanel, panelOpen)
  useEscape(closePanel, panelOpen)
  const panelId = useId()
  const inputId = useId()

  const flat = useMemo(() => toc.flatMap((group) => group.sections.map((section) => section.id)), [toc])
  const titles = useMemo(
    () => new Map(toc.flatMap((group) => group.sections.map((section) => [section.id, section.title] as const))),
    [toc],
  )

  // Текст разделов — один раз, из готовой разметки.
  useEffect(() => {
    setIndex(
      sectionNodes().map((node) => ({
        id: node.id,
        title: node.querySelector('[data-doc-title]')?.textContent ?? '',
        group: node.dataset.docGroupTitle ?? '',
        text: readableTextNodes(node, false)
          .map((text) => text.data)
          .join(' '),
      })),
    )
    setStatusSlot(document.getElementById('docs-search-status'))

    // Внутри системы текст появляется после загрузки каркаса (он сначала спрашивает, кто вошёл), и браузер
    // к этому времени уже «прокрутил» к якорю пустую страницу. Докручиваем сами.
    const id = decodeURIComponent(window.location.hash.slice(1))
    const target = id ? document.getElementById(id) : null
    // Переход из «?» у кнопки (решение 217) приходит на подраздел. Внутри системы
    // адрес меняет роутер без настоящего перехода, и `:target` у подраздела не
    // срабатывает — отмечаем его сами, тем же видом.
    if (target) target.setAttribute('data-doc-target', '')
    if (target && target.getBoundingClientRect().top > window.innerHeight / 2) {
      requestAnimationFrame(() => target.scrollIntoView({ block: 'start' }))
    }
  }, [])

  const searching = isSearchable(query)
  const hits: DocsSearchHit[] = useMemo(() => (searching ? searchDocs(index, query) : []), [index, query, searching])

  // Найденное — видно и подсвечено, остальное спрятано. Сброс поиска возвращает всё как было.
  useEffect(() => {
    const nodes = sectionNodes()
    const groups = Array.from(document.querySelectorAll<HTMLElement>('#docs-article [data-doc-group]'))
    const api = highlightApi()
    for (const details of openedDetails.current) details.open = false
    openedDetails.current = []

    if (!searching) {
      for (const node of nodes) node.hidden = false
      for (const group of groups) group.hidden = false
      api?.registry.delete(HIGHLIGHT)
      return
    }

    const found = new Set(hits.map((hit) => hit.id))
    for (const node of nodes) node.hidden = !found.has(node.id)
    for (const group of groups) {
      group.hidden = !Array.from(group.querySelectorAll<HTMLElement>('[data-doc-section]')).some((node) => !node.hidden)
    }

    const terms = queryTerms(query)
    const ranges: Range[] = []
    for (const node of nodes) {
      if (node.hidden) continue
      for (const text of readableTextNodes(node, true)) {
        const matches = findRanges(text.data, terms)
        if (matches.length === 0) continue
        const details = text.parentElement?.closest('details')
        if (details && !details.open) {
          details.open = true
          openedDetails.current.push(details)
        }
        for (const [from, to] of matches) {
          const range = document.createRange()
          range.setStart(text, from)
          range.setEnd(text, to)
          ranges.push(range)
        }
      }
    }
    if (api) api.registry.set(HIGHLIGHT, new api.Highlight(...ranges))
  }, [hits, query, searching])

  useEffect(() => () => highlightApi()?.registry.delete(HIGHLIGHT), [])

  // Текущий раздел — верхний видимый под шапкой.
  useEffect(() => {
    const nodes = sectionNodes()
    if (nodes.length === 0) return
    const visible = new Set<string>()
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target.id)
          else visible.delete(entry.target.id)
        }
        const first = nodes.find((node) => visible.has(node.id))
        if (first) setActiveId(first.id)
      },
      // Верхняя граница — ниже отступа якоря (шапка + строка поиска на телефоне):
      // раздел, к которому перешли по ссылке, и считается текущим, а не хвост предыдущего.
      { rootMargin: '-144px 0px -55% 0px' },
    )
    nodes.forEach((node) => observer.observe(node))
    return () => observer.disconnect()
  }, [])

  // Текущий пункт держится в видимой части оглавления — без прокрутки страницы.
  useEffect(() => {
    const list = listRef.current
    const item = activeId ? list?.querySelector<HTMLElement>(`[data-toc-id="${CSS.escape(activeId)}"]`) : null
    if (!list || !item || list.scrollHeight <= list.clientHeight) return
    // Положение пункта внутри прокручиваемого списка — по координатам: offsetTop
    // считается от ближайшего позиционированного предка (списка группы), а не от оглавления.
    const top = item.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop
    if (top < list.scrollTop + 40 || top > list.scrollTop + list.clientHeight - 80) {
      list.scrollTop = Math.max(0, top - list.clientHeight / 3)
    }
  }, [activeId])

  // «Наверх» — после первого экрана-другого.
  useEffect(() => {
    const onScroll = () => setShowToTop(window.scrollY > TO_TOP_AFTER)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // «/» ставит курсор в поиск, если человек не печатает в другом поле.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target as HTMLElement | null
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return
      event.preventDefault()
      inputRef.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const goTo = useCallback(
    (id: string, event?: MouseEvent) => {
      const target = document.getElementById(id)
      if (!target) return
      event?.preventDefault()
      setPanelOpen(false)
      target.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' })
      window.history.replaceState(null, '', `#${id}`)
      const heading = target.querySelector<HTMLElement>('[data-doc-title]')
      if (heading) {
        heading.tabIndex = -1
        heading.focus({ preventScroll: true })
      }
      setActiveId(id)
    },
    [reducedMotion],
  )

  function reset() {
    setQuery('')
    inputRef.current?.focus()
  }

  const activeIndex = activeId ? flat.indexOf(activeId) : -1
  const activeTitle = activeId ? (titles.get(activeId) ?? (activeId === 'terms' ? 'Словарь терминов' : null)) : null

  const tocList = (
    <div className={styles.toc} ref={listRef}>
      {toc.map((group) => (
        <div key={group.id} className={styles.tocGroup}>
          <p className={styles.tocGroupTitle}>{group.title}</p>
          <ol className={styles.tocList}>
            {group.sections.map((section) => {
              const position = flat.indexOf(section.id)
              const state = position === activeIndex ? 'current' : activeIndex > -1 && position < activeIndex ? 'passed' : 'ahead'
              return (
                <li key={section.id} className={styles.tocItem} data-state={state} data-toc-id={section.id}>
                  <a
                    href={`#${section.id}`}
                    className={styles.tocLink}
                    aria-current={state === 'current' ? 'location' : undefined}
                    onClick={(event) => goTo(section.id, event)}
                  >
                    {section.title}
                  </a>
                </li>
              )
            })}
          </ol>
        </div>
      ))}
    </div>
  )

  const results = (
    <div className={styles.results} ref={listRef}>
      <p className={styles.resultsCount} aria-live="polite">
        {hits.length === 0 ? 'Ничего не нашлось' : `Найдено разделов: ${hits.length}`}
      </p>
      <ol className={styles.resultsList}>
        {hits.map((hit) => (
          <li key={hit.id}>
            <a href={`#${hit.id}`} className={styles.result} onClick={(event) => goTo(hit.id, event)}>
              <span className={styles.resultTitle}>{hit.title}</span>
              <span className={styles.resultGroup}>{hit.group}</span>
              <span className={styles.resultSnippet}>
                {hit.snippet.map((part, i) => (part.match ? <mark key={i}>{part.text}</mark> : <span key={i}>{part.text}</span>))}
              </span>
            </a>
          </li>
        ))}
      </ol>
    </div>
  )

  return (
    <nav ref={navRef} className={styles.nav} aria-label="Документация" data-panel-open={panelOpen || undefined}>
      <div className={styles.navBar}>
        <button
          type="button"
          className={styles.tocToggle}
          aria-expanded={panelOpen}
          aria-controls={panelId}
          onClick={() => setPanelOpen((open) => !open)}
        >
          <span className={styles.tocToggleLabel}>{searching ? 'Найденное' : 'Оглавление'}</span>
          {!searching && activeTitle && <span className={styles.tocToggleCurrent}>{activeTitle}</span>}
          <Icon name="chevronDown" size={16} className={panelOpen ? styles.chevronOpen : styles.chevron} />
        </button>

        <div className={styles.search} role="search">
          <label htmlFor={inputId} className="visually-hidden">
            Поиск по документации
          </label>
          <Icon name="search" size={16} className={styles.searchIcon} />
          <input
            ref={inputRef}
            id={inputId}
            type="search"
            className={styles.searchInput}
            placeholder={narrow ? 'Поиск' : 'Поиск по документации'}
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && query) {
                event.preventDefault()
                event.stopPropagation()
                setQuery('')
              }
              if (event.key === 'Enter' && hits[0]) goTo(hits[0].id)
            }}
          />
          {!query && (
            <kbd className={styles.searchKey} aria-hidden="true">
              /
            </kbd>
          )}
        </div>
      </div>

      <div id={panelId} className={styles.navPanel}>
        {searching ? results : tocList}
        {!searching && (
          <a href="#terms" className={styles.tocTerms} onClick={(event) => goTo('terms', event)}>
            Словарь терминов
          </a>
        )}
      </div>

      {statusSlot &&
        searching &&
        createPortal(
          hits.length > 0 ? (
            <p className={styles.status}>
              <span>
                По запросу «{query.trim()}» — {hits.length === 1 ? 'один раздел' : `разделов: ${hits.length}`}. Совпадения подсвечены.
              </span>
              <button type="button" className={styles.statusReset} onClick={reset}>
                Сбросить поиск
              </button>
            </p>
          ) : (
            <div className={styles.empty}>
              <p className={styles.emptyTitle}>По запросу «{query.trim()}» ничего не нашлось</p>
              <p className={styles.emptyText}>
                Попробуйте слово короче или другое — например, одно из этих:
              </p>
              <div className={styles.suggestions}>
                {DOCS_SEARCH_SUGGESTIONS.map((word) => (
                  <button key={word} type="button" className={styles.suggestion} onClick={() => setQuery(word)}>
                    {word}
                  </button>
                ))}
              </div>
              <button type="button" className={styles.statusReset} onClick={reset}>
                Сбросить поиск
              </button>
            </div>
          ),
          statusSlot,
        )}

      {showToTop &&
        createPortal(
          <button
            type="button"
            className={styles.toTop}
            data-variant={variant}
            onClick={() => window.scrollTo({ top: 0, behavior: reducedMotion ? 'auto' : 'smooth' })}
          >
            <Icon name="chevronDown" size={16} className={styles.toTopIcon} />
            Наверх
          </button>,
          document.body,
        )}
    </nav>
  )
}
