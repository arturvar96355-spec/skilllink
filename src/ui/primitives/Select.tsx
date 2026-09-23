'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Icon } from './Icon'
import { Field } from './Form'
import { useOutsideClick, useEscape } from '../hooks/dom'
import styles from './Select.module.css'

export interface SelectOption {
  value: string
  label: string
}

/**
 * Поиск по списку на сервере. Нужен спискам, которые целиком не загружаются:
 * вузов бывает тысяча, а в выпадающий список раньше попадала первая сотня —
 * связку с вузом дальше по алфавиту нельзя было создать. Задаёт `RemoteSelect`.
 */
export interface SelectSearch {
  query: string
  onQueryChange: (query: string) => void
  placeholder: string
  /** Строка под списком: «показаны 50 из 1004» или «ничего не найдено». */
  note?: string | null
}

export interface SelectProps {
  label?: string
  hint?: string
  error?: string | null
  /** Пустая строка — значение не выбрано; в фильтрах это «любое». */
  value: string
  onValueChange: (value: string) => void
  options: SelectOption[]
  /** Текст, когда ничего не выбрано. Он же — первый пункт списка. */
  placeholder?: string
  disabled?: boolean
  required?: boolean
  name?: string
  /** Подпись только для программ чтения с экрана — см. Field. */
  hideLabel?: boolean
  search?: SelectSearch
  /**
   * Подпись выбранного значения, если его нет среди `options`: выбрано
   * через поиск, а сейчас в списке другая выборка.
   */
  valueLabel?: string
}

/**
 * Выпадающий список в стиле системы.
 *
 * Системный `<select>` отдаёт список браузеру: он рисуется средствами
 * операционной системы, не знает ни про тёмную тему, ни про скругления,
 * ни про подсветку пункта. Дизайн-система требует единый вид всех выпадающих
 * списков (раздел 22), поэтому список рисуется сам.
 *
 * С клавиатуры работает как обычный список: стрелки — перебор, Enter — выбор,
 * Escape — закрыть. Это не украшение: без клавиатуры фильтры недоступны тем,
 * кто не пользуется мышью (раздел 33).
 */
export function Select({
  label,
  hint,
  error,
  value,
  onValueChange,
  options,
  placeholder,
  disabled = false,
  required = false,
  name,
  hideLabel = false,
  search,
  valueLabel,
}: SelectProps) {
  const id = useId()
  const [isOpen, setIsOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const [openUpward, setOpenUpward] = useState(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)

  // Пока идёт поиск, пункт «любое» не нужен: человек ищет конкретное.
  const withPlaceholder = placeholder !== undefined && !(search && search.query !== '')
  const items: SelectOption[] = withPlaceholder
    ? [{ value: '', label: placeholder }, ...options]
    : options

  const close = useCallback(() => setIsOpen(false), [])
  const wrapperRef = useOutsideClick<HTMLDivElement>(close, isOpen)
  // По Escape фокус возвращается на кнопку списка, а не теряется: поле
  // поиска, где он был, исчезает вместе со списком. По щелчку снаружи — нет:
  // там фокус уходит туда, куда щёлкнули.
  const closeByEscape = useCallback(() => {
    setIsOpen(false)
    triggerRef.current?.focus()
  }, [])
  useEscape(closeByEscape, isOpen)

  const selected = items.find((option) => option.value === value)
  const shownLabel = selected?.label ?? (value !== '' ? valueLabel : undefined)
  const hasValue = value !== '' && shownLabel !== undefined

  function open() {
    if (disabled) return
    const rect = triggerRef.current?.getBoundingClientRect()
    // Список выше края экрана уводит выбор за пределы видимости — открываем вверх.
    if (rect) setOpenUpward(window.innerHeight - rect.bottom < 300 && rect.top > 300)
    setActiveIndex(Math.max(0, items.findIndex((option) => option.value === value)))
    setIsOpen(true)
  }

  function choose(option: SelectOption) {
    onValueChange(option.value)
    setIsOpen(false)
    triggerRef.current?.focus()
  }

  /** Перебор и выбор — общие для кнопки и поля поиска. */
  function navigate(event: React.KeyboardEvent, chooseKeys: string[]) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (items.length > 0) setActiveIndex((current) => (current + 1) % items.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (items.length > 0) setActiveIndex((current) => (current - 1 + items.length) % items.length)
    } else if (chooseKeys.includes(event.key)) {
      // Enter в модальном окне иначе отправил бы форму.
      event.preventDefault()
      const option = items[activeIndex]
      if (option) choose(option)
    } else if (event.key === 'Tab') {
      setIsOpen(false)
    }
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (!isOpen) {
      if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        open()
      }
      return
    }
    navigate(event, ['Enter', ' '])
  }

  // В поле поиска пробел — часть запроса («Уральский федеральный»), а не выбор.
  // Escape здесь не ловится: его разбирает стопка слоёв (useEscape).
  function onSearchKeyDown(event: React.KeyboardEvent) {
    navigate(event, ['Enter'])
  }

  // С поиском фокус сразу в поле: открыл список — и печатаешь. Только
  // в момент открытия, иначе каждый ответ поиска выдёргивал бы фокус.
  const hasSearch = search !== undefined
  useEffect(() => {
    if (isOpen && hasSearch) searchRef.current?.focus()
  }, [isOpen, hasSearch])

  // Новая выборка — подсветка на первом пункте, а не за концом списка.
  useEffect(() => {
    setActiveIndex((current) => (current < items.length ? current : 0))
  }, [items.length])

  // Выбранный пункт должен быть виден, когда список открыли с клавиатуры.
  useEffect(() => {
    if (!isOpen) return
    const node = document.getElementById(`${id}-option-${activeIndex}`)
    node?.scrollIntoView({ block: 'nearest' })
  }, [isOpen, activeIndex, id])

  return (
    <Field
      label={label}
      hint={hint}
      error={error}
      required={required}
      htmlFor={`${id}-trigger`}
      hideLabel={hideLabel}
    >
      <div className={styles.wrapper} ref={wrapperRef}>
        <button
          id={`${id}-trigger`}
          ref={triggerRef}
          type="button"
          name={name}
          className={[styles.trigger, isOpen ? styles.open : '', error ? styles.invalid : '']
            .filter(Boolean)
            .join(' ')}
          onClick={() => (isOpen ? close() : open())}
          onKeyDown={onKeyDown}
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          aria-invalid={error ? true : undefined}
        >
          <span
            className={[styles.value, hasValue ? '' : styles.placeholder].filter(Boolean).join(' ')}
          >
            {shownLabel ?? placeholder ?? 'Выберите'}
          </span>
          <Icon
            name="chevronDown"
            size={16}
            className={[styles.arrow, isOpen ? styles.arrowOpen : ''].filter(Boolean).join(' ')}
          />
        </button>

        {isOpen && (
          <div className={[styles.list, openUpward ? styles.listUp : ''].filter(Boolean).join(' ')}>
            {search && (
              <div className={styles.searchRow}>
                <Icon name="search" size={16} className={styles.searchIcon} />
                <input
                  ref={searchRef}
                  className={styles.search}
                  value={search.query}
                  placeholder={search.placeholder}
                  aria-label={search.placeholder}
                  aria-controls={`${id}-listbox`}
                  aria-activedescendant={items[activeIndex] ? `${id}-option-${activeIndex}` : undefined}
                  onChange={(event) => {
                    search.onQueryChange(event.target.value)
                    setActiveIndex(0)
                  }}
                  onKeyDown={onSearchKeyDown}
                />
              </div>
            )}
            <div id={`${id}-listbox`} role="listbox" aria-label={label}>
              {items.map((option, index) => (
                <button
                  key={option.value || 'any'}
                  id={`${id}-option-${index}`}
                  type="button"
                  role="option"
                  aria-selected={option.value === value}
                  className={[
                    styles.option,
                    index === activeIndex ? styles.active : '',
                    option.value === value ? styles.selected : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => choose(option)}
                >
                  {option.label}
                  {option.value === value && <Icon name="check" size={16} className={styles.check} />}
                </button>
              ))}
            </div>
            {search?.note && <div className={styles.note}>{search.note}</div>}
          </div>
        )}
      </div>
    </Field>
  )
}
