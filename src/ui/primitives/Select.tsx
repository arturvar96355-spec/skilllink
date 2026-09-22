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
}: SelectProps) {
  const id = useId()
  const [isOpen, setIsOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const [openUpward, setOpenUpward] = useState(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)

  const items: SelectOption[] =
    placeholder === undefined ? options : [{ value: '', label: placeholder }, ...options]

  const close = useCallback(() => setIsOpen(false), [])
  const wrapperRef = useOutsideClick<HTMLDivElement>(close, isOpen)
  useEscape(close, isOpen)

  const selected = items.find((option) => option.value === value)

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

  function onKeyDown(event: React.KeyboardEvent) {
    if (!isOpen) {
      if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        open()
      }
      return
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((current) => (current + 1) % items.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((current) => (current - 1 + items.length) % items.length)
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      const option = items[activeIndex]
      if (option) choose(option)
    } else if (event.key === 'Tab') {
      setIsOpen(false)
    }
  }

  // Выбранный пункт должен быть виден, когда список открыли с клавиатуры.
  useEffect(() => {
    if (!isOpen) return
    const node = document.getElementById(`${id}-option-${activeIndex}`)
    node?.scrollIntoView({ block: 'nearest' })
  }, [isOpen, activeIndex, id])

  return (
    <Field label={label} hint={hint} error={error} required={required} htmlFor={`${id}-trigger`}>
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
            className={[styles.value, selected && selected.value !== '' ? '' : styles.placeholder]
              .filter(Boolean)
              .join(' ')}
          >
            {selected?.label ?? placeholder ?? 'Выберите'}
          </span>
          <Icon
            name="chevronDown"
            size={16}
            className={[styles.arrow, isOpen ? styles.arrowOpen : ''].filter(Boolean).join(' ')}
          />
        </button>

        {isOpen && (
          <div
            className={[styles.list, openUpward ? styles.listUp : ''].filter(Boolean).join(' ')}
            role="listbox"
            aria-label={label}
          >
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
        )}
      </div>
    </Field>
  )
}
