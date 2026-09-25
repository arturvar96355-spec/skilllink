import { conflict, validationError, type AppError } from '@/shared/http/errors'
import { countWithNoun } from '@/shared/utils/text'

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

/**
 * Отказ на дубль названия.
 *
 * Название — то, по чему продукт выбирают в форме связки: два одинаковых
 * пункта в списке неотличимы. Сравнение без учёта регистра — «облачная платформа
 * РТК» и «Облачная платформа РТК» один и тот же продукт, хотя ограничение базы
 * их различает. Поле в `details` — чтобы форма подсветила именно название.
 */
export function duplicateNameConflict(name: string): AppError {
  return conflict(`IT-продукт «${name}» уже есть в реестре. Выберите другое название.`, [
    { field: 'name', message: 'Продукт с таким названием уже есть' },
  ])
}

const OPEN_COOPERATION_FORMS = ['открытая связка', 'открытые связки', 'открытых связок'] as const

/**
 * Версию продукта с открытыми связками правкой карточки не поменять.
 *
 * Новая версия означает, что вузам передана устаревшая (этап 12). Тихая правка
 * поля оставила бы этап закрытым, а материалы — старыми; для этого есть выпуск
 * версии, который ставит задачи и переоткрывает этапы. Без связок версию
 * можно просто исправить — затронуть нечего.
 */
export function assertVersionEditable(
  current: string | null,
  next: string | null | undefined,
  openCooperations: number,
): void {
  if (next === undefined || next === current || openCooperations === 0) return
  throw conflict(
    `У продукта ${countWithNoun(openCooperations, OPEN_COOPERATION_FORMS)}: ` +
      'новая версия передаётся вузам выпуском версии, он откроет этап обновления материалов. ' +
      'Правкой карточки версию не поменять.',
    [
      {
        field: 'version',
        message: 'У продукта есть открытые связки: новую версию передаёт им выпуск версии',
      },
    ],
  )
}
