import { cookies, headers } from 'next/headers'

/**
 * Запрос к собственному API из серверного компонента.
 *
 * Обычный `fetch` на сервере **не несёт cookie пользователя**: запрос уходит
 * от имени процесса, а не от имени того, кто открыл страницу. В демо-режиме это
 * молча подставляет пользователя по умолчанию, и страница показывает чужие данные —
 * представитель вуза увидел бы кабинет менеджера. В промышленном режиме тот же
 * запрос вернёт 401, и страница окажется пустой.
 *
 * Ошибка не заметна при разработке: под менеджером всё выглядит правильно.
 * Поэтому здесь и есть эта обёртка — чтобы правильный способ был короче неправильного.
 *
 * ```tsx
 * import { apiFetch } from '@/shared/api/server-fetch'
 *
 * export default async function Page() {
 *   const response = await apiFetch('/api/universities?pageSize=20')
 *   const body = await response.json()
 *   return <div>{body.data.length}</div>
 * }
 * ```
 *
 * В клиентских компонентах обёртка не нужна: браузер отправляет cookie сам.
 */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const [cookieStore, headerList] = await Promise.all([cookies(), headers()])

  // Адрес берём из заголовков запроса: так страница работает на любом порту
  // и за обратным прокси, а не только на localhost:3000.
  const host = headerList.get('x-forwarded-host') ?? headerList.get('host')
  const protocol = headerList.get('x-forwarded-proto') ?? 'http'
  const base = host ? `${protocol}://${host}` : (process.env.APP_BASE_URL ?? 'http://localhost:3000')

  const cookieHeader = cookieStore.toString()

  return fetch(`${base}${path}`, {
    ...init,
    // Данные страницы не кешируются: иначе после действия пользователь увидит
    // прежнее состояние и решит, что оно не сохранилось.
    cache: init.cache ?? 'no-store',
    headers: {
      ...init.headers,
      ...(cookieHeader ? { cookie: cookieHeader } : {}),
    },
  })
}
