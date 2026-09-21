import { conflict, validationError } from '@/shared/http/errors'

/**
 * Этап, на котором вузу передаётся актуальная версия продукта:
 * «Обновление документации и материалов» (раздел 8 ТЗ).
 *
 * Выпуск новой версии означает, что у всех связок с этим продуктом переданная версия
 * устарела, — и именно этот этап нужно снова открыть.
 */
export const MATERIALS_UPDATE_STAGE_NUMBER = 12

/** Статусы связок, которые затрагивает групповая операция. Закрытые связки не трогаем. */
export const BULK_TARGET_STATUSES = ['DRAFT', 'ACTIVE', 'PAUSED'] as const

export function assertVersionChanged(current: string | null, next: string): void {
  if (current === next) {
    throw conflict(`У продукта уже указана версия ${next}`, { version: next })
  }
}

export function assertVersionFormat(version: string): void {
  if (version.trim().length === 0) {
    throw validationError('Версия не может быть пустой', [
      { field: 'version', message: 'Укажите версию продукта' },
    ])
  }
}

/** Текст задачи, которая ставится во все затронутые связки. */
export function releaseTaskTitle(productName: string, version: string): string {
  return `Передать версию ${version} продукта «${productName}»`
}

/** Комментарий в историю при переоткрытии закрытого этапа. */
export function reopenComment(productName: string, version: string): string {
  return `Выпущена версия ${version} продукта «${productName}»: переданные материалы устарели`
}
