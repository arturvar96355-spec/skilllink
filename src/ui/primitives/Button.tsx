'use client'

import Link from 'next/link'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Icon, type IconName } from './Icon'
import styles from './Button.module.css'

/**
 * Кнопка интерфейса.
 *
 * Вариантов ровно четыре, и новый вариант «только для этой страницы» заводить
 * нельзя (раздел 35 документа об интерфейсе). Если действие выглядит иначе —
 * значит, у него другая роль, и нужен существующий вариант, а не новый стиль.
 */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'lg'

interface CommonProps {
  variant?: ButtonVariant
  size?: ButtonSize
  icon?: IconName
  iconPosition?: 'left' | 'right'
  isLoading?: boolean
  fullWidth?: boolean
  children?: ReactNode
}

export interface ButtonProps
  extends CommonProps,
    Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** Задан — получается ссылка с видом кнопки: переход должен оставаться ссылкой. */
  href?: string
  /**
   * Ссылка ведёт не на страницу приложения, а к файлу или на внешний адрес.
   *
   * Обычная ссылка Next перехватывает переход и пытается открыть маршрут —
   * для выгрузки файла это означает пустой экран вместо сохранения.
   */
  external?: boolean
}

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  iconPosition = 'left',
  isLoading = false,
  fullWidth = false,
  href,
  external = false,
  className,
  children,
  disabled,
  // Подсказка и доступное имя нужны всем видам кнопки, включая ссылку:
  // остальные свойства кнопки к ссылке неприменимы и остаются у <button>.
  title,
  'aria-label': ariaLabel,
  ...props
}: ButtonProps) {
  const classes = [
    styles.button,
    styles[variant],
    styles[size],
    fullWidth ? styles.full : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ')

  const iconSize = size === 'lg' ? 20 : 18
  const content = (
    <>
      {icon && iconPosition === 'left' && (
        <Icon name={icon} size={iconSize} className={isLoading ? styles.loadingLabel : undefined} />
      )}
      {children !== undefined && (
        <span className={isLoading ? styles.loadingLabel : undefined}>{children}</span>
      )}
      {icon && iconPosition === 'right' && (
        <Icon name={icon} size={iconSize} className={isLoading ? styles.loadingLabel : undefined} />
      )}
      {isLoading && <span className={styles.spinner} aria-hidden="true" />}
    </>
  )

  if (href !== undefined && !disabled) {
    if (external) {
      return (
        <a href={href} className={classes} rel="noreferrer" title={title} aria-label={ariaLabel}>
          {content}
        </a>
      )
    }
    return (
      <Link href={href} className={classes} title={title} aria-label={ariaLabel}>
        {content}
      </Link>
    )
  }

  return (
    <button
      type="button"
      className={classes}
      title={title}
      aria-label={ariaLabel}
      // Пока запрос идёт, повторное нажатие запрещено: иначе уйдут два запроса.
      disabled={disabled || isLoading}
      aria-busy={isLoading || undefined}
      {...props}
    >
      {content}
    </button>
  )
}
