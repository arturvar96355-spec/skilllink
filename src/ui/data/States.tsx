'use client'

import type { ReactNode } from 'react'
import { Button } from '../primitives/Button'
import { Icon, type IconName } from '../primitives/Icon'
import { Skeleton } from '../primitives/Skeleton'
import type { ApiRequestError } from '../lib/api'
import { ROUTES } from '../lib/links'
import styles from './States.module.css'

/**
 * Три состояния, в которых экран ещё не показывает данные.
 *
 * Вынесены в общие компоненты, потому что каждый экран обязан иметь все три
 * (docs/DESIGN_INTEGRATION.md), а написанные заново они каждый раз получаются
 * разными: где-то «Ничего не найдено», где-то пустой белый прямоугольник.
 */

export interface EmptyStateProps {
  /**
   * Не рисуется: значок в скруглённом квадрате над «Ничего нет» — декор,
   * который ничего не сообщает (07, раздел 5). Пустое состояние говорит
   * текстом. Параметр оставлен, чтобы не трогать все вызовы разом.
   */
  icon?: IconName
  title: string
  description?: string
  action?: ReactNode
}

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className={styles.block}>
      <p className={styles.title}>{title}</p>
      {description && <p className={styles.description}>{description}</p>}
      {action && <div className={styles.actions}>{action}</div>}
    </div>
  )
}

export interface ErrorStateProps {
  error: ApiRequestError
  onRetry?: () => void
}

/**
 * Ошибка показывается текстом с сервера.
 *
 * Он уже на русском и объясняет причину («Этап 7 — контрольная точка…»).
 * Подменять его своим «что-то пошло не так» нельзя: на отказах системы
 * держится весь показ.
 */
export function ErrorState({ error, onRetry }: ErrorStateProps) {
  const isAccessDenied = error.code === 'FORBIDDEN'
  // «Нет такой записи» — не сбой: повтор ничего не даст, а «Не удалось загрузить»
  // с кнопкой «Повторить» обещало, что со второго раза получится.
  const isMissing = error.code === 'NOT_FOUND'
  const title = isAccessDenied ? 'Раздел недоступен' : isMissing ? 'Не найдено' : 'Не удалось загрузить'
  return (
    <div className={styles.block}>
      <span className={[styles.icon, isMissing ? '' : styles.iconError].filter(Boolean).join(' ')}>
        <Icon name={isAccessDenied ? 'lock' : isMissing ? 'search' : 'alert'} size={24} />
      </span>
      <p className={styles.title}>{title}</p>
      <p className={styles.description}>
        {isMissing
          ? `${error.message.replace(/\.$/, '')}. Возможно, запись удалили или ссылка устарела.`
          : error.message}
      </p>
      {onRetry && !isAccessDenied && !isMissing && (
        <div className={styles.actions}>
          <Button icon="refresh" onClick={onRetry}>
            Повторить
          </Button>
        </div>
      )}
    </div>
  )
}

/**
 * Раздел, которого нет в роли пользователя (пробел ТЗ, решение 153).
 *
 * Показывается вместо содержимого страницы — по прямой ссылке на раздел,
 * закрытый роли (охранник маршрута `isSectionAllowed`, `ui/layout/navigation.ts`,
 * применяется в `AppShell`), а не после отказа API: страница со своими запросами
 * вообще не монтируется, поэтому пустого экрана или сырого 403 не возникает.
 *
 * Тот же вид, что у `ErrorState` для кода `FORBIDDEN` («Раздел недоступен»,
 * значок замка), — это тот же смысл, только раньше запроса к серверу. Кнопка —
 * не всегда «На главную»: представителю вуза «На главную» ведёт на `/`, откуда
 * его страница сама перенаправляет в `/portal` (решение 9), — здесь прямая
 * ссылка в его кабинет, без лишнего перехода.
 */
export function SectionUnavailable({ isUniversityRep }: { isUniversityRep: boolean }) {
  return (
    <div className={styles.block}>
      <span className={[styles.icon, styles.iconError].join(' ')}>
        <Icon name="lock" size={24} />
      </span>
      <p className={styles.title}>Раздел недоступен</p>
      <p className={styles.description}>
        Этого раздела нет в вашей роли. Если это ошибка, обратитесь к администратору системы.
      </p>
      <div className={styles.actions}>
        <Button icon={isUniversityRep ? 'university' : 'home'} href={isUniversityRep ? ROUTES.portal : ROUTES.dashboard}>
          {isUniversityRep ? 'В кабинет вуза' : 'На главную'}
        </Button>
      </div>
    </div>
  )
}

/** Скелетон списка карточек. */
export function CardsSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className={styles.cards} aria-busy="true" aria-live="polite">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className={styles.card}>
          <Skeleton height="16px" width="80%" />
          <Skeleton height="12px" width="50%" />
          <Skeleton height="6px" />
        </div>
      ))}
    </div>
  )
}

/** Скелетон таблицы: столько же столбцов, сколько будет в данных. */
export function TableSkeleton({ rows = 6, columns = 4 }: { rows?: number; columns?: number }) {
  return (
    <div className={styles.rows} aria-busy="true" aria-live="polite">
      {Array.from({ length: rows }, (_, rowIndex) => (
        <div
          key={rowIndex}
          className={styles.row}
          style={{ gridTemplateColumns: `2fr ${'1fr '.repeat(Math.max(columns - 1, 1))}` }}
        >
          {Array.from({ length: columns }, (_, cellIndex) => (
            <Skeleton key={cellIndex} height="14px" width={cellIndex === 0 ? '90%' : '60%'} />
          ))}
        </div>
      ))}
    </div>
  )
}
