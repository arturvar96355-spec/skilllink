'use client'

import { useCallback, useState } from 'react'
import { ApiRequestError } from '../lib/api'
import { leaveToLogin } from '../lib/session'

/**
 * Изменяющий запрос: отправка формы, смена статуса этапа, отметка в чек-листе.
 *
 * Отдельно от загрузки данных, потому что здесь важно другое: пока запрос идёт,
 * кнопка должна быть заблокирована (иначе двойное нажатие отправит два запроса),
 * а ошибку нужно показать рядом с действием, а не вместо всего экрана.
 * Отказ системы — часть сценария показа: текст ошибки приходит с сервера
 * на русском и выводится как есть.
 */

/**
 * Результат попытки.
 *
 * Ошибка возвращается вызывающему коду, а не только кладётся в состояние хука.
 * Причина в том, как устроен React: `run()` внутри обработчика видит объект
 * хука из того рендера, в котором обработчик создан, и `mutation.error` сразу
 * после `await` там всё ещё пустой. Отказ системы — главное, что должен увидеть
 * пользователь на этом экране, и полагаться на такой порядок нельзя.
 */
export type MutationResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: ApiRequestError }

export interface Mutation<TInput, TOutput> {
  run: (input: TInput) => Promise<MutationResult<TOutput>>
  isPending: boolean
  /** Последняя ошибка — для показа в разметке; в обработчике берите её из результата. */
  error: ApiRequestError | null
  reset: () => void
}

export function useMutation<TInput, TOutput>(
  action: (input: TInput) => Promise<TOutput>,
): Mutation<TInput, TOutput> {
  const [isPending, setIsPending] = useState(false)
  const [error, setError] = useState<ApiRequestError | null>(null)

  const run = useCallback(
    async (input: TInput): Promise<MutationResult<TOutput>> => {
      setIsPending(true)
      setError(null)
      try {
        const data = await action(input)
        return { ok: true, data }
      } catch (caught: unknown) {
        const apiError =
          caught instanceof ApiRequestError
            ? caught
            : new ApiRequestError('Непредвиденная ошибка', 'INTERNAL', 0)
        setError(apiError)
        // Без сессии действие не выполнится и со второй попытки: отказ
        // «Требуется вход» в карточке этапа читался бы как отказ системы.
        if (apiError.code === 'UNAUTHORIZED') void leaveToLogin()
        return { ok: false, error: apiError }
      } finally {
        setIsPending(false)
      }
    },
    [action],
  )

  const reset = useCallback(() => setError(null), [])

  return { run, isPending, error, reset }
}
